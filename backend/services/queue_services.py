"""
Queue business logic (framework-agnostic, no FastAPI imports).

Rules
-----
* Functions flush but NEVER commit - the caller (API route / scheduler) commits.
* Concurrency is handled with row locks:
    - issuing a token locks the department row  -> gap-free, duplicate-free token numbers
    - check-in / status changes lock the token row -> no double check-in
    - calling the next patient locks the doctor row, then picks the next physical token
      with FOR UPDATE SKIP LOCKED -> two doctors never get the same patient
* Only PHYSICAL tokens can be called. Virtual tokens have to be checked in first.
* Physical queue order: priority (0 = emergency first), then check-in time, then id.
* Every datetime is stored as UTC; "today" is the hospital's local date (config.HOSPITAL_TIMEZONE).

Absence
-------
* Virtual patient never reports -> lapse_overdue_virtual_tokens() closes the token (NO_SHOW).
* Called patient does not reach the doctor -> mark_absent(): moved to the back of the physical
  queue up to MAX_ABSENT_RECALLS times, after that NO_SHOW.
* Staff can undo a NO_SHOW for the same day with reinstate_no_show() (patient turned up late).
"""
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import settings
from database import models as m
from database import qr_codes
from services import eta, notify
from services.errors import (BadRequest, Conflict, Forbidden, InvalidQR, NotFound,  # noqa: F401 (re-exported)
                             QueueError)
from services.eta import estimate_wait_minutes
from services.timeutil import aware, fmt_time, local_today, minutes_between, now_utc

ACTIVE = (m.TokenStatus.WAITING, m.TokenStatus.CALLED, m.TokenStatus.IN_CONSULTATION)
NT = m.NotificationType


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _normalize_phone(phone: str) -> str:
    return re.sub(r"[^\d+]", "", phone or "")


def assert_staff_access(staff: m.StaffUser, hospital_id: int) -> None:
    if staff.role != m.StaffRole.SUPER_ADMIN and staff.hospital_id != hospital_id:
        raise Forbidden("You do not have access to this hospital")


def _get_department(db: Session, department_id: int) -> m.Department:
    dept = db.get(m.Department, department_id)
    if dept is None:
        raise NotFound("Department not found")
    return dept


def _hospital_of(db: Session, dept: m.Department) -> m.Hospital:
    return db.get(m.Hospital, dept.hospital_id)


# --------------------------------------------------------------------------- #
# Queue statistics
# --------------------------------------------------------------------------- #
@dataclass
class QueueCounts:
    virtual_waiting: int
    physical_waiting: int
    in_progress: int      # called or in consultation
    doctors_available: int


def queue_counts(db: Session, department_id: int, day: date) -> QueueCounts:
    rows = db.execute(
        select(m.Token.queue_type, m.Token.status, func.count())
        .where(m.Token.department_id == department_id, m.Token.token_date == day,
               m.Token.status.in_(ACTIVE))
        .group_by(m.Token.queue_type, m.Token.status)
    ).all()
    virtual_waiting = physical_waiting = in_progress = 0
    for queue_type, status, n in rows:
        if status == m.TokenStatus.WAITING:
            if queue_type == m.QueueType.VIRTUAL:
                virtual_waiting += n
            else:
                physical_waiting += n
        else:
            in_progress += n
    doctors = db.scalar(
        select(func.count()).select_from(m.Doctor).where(
            m.Doctor.department_id == department_id, m.Doctor.is_active.is_(True),
            m.Doctor.status == m.DoctorStatus.AVAILABLE)
    ) or 0
    return QueueCounts(virtual_waiting, physical_waiting, in_progress, doctors)


def _count_ahead_of_new(db: Session, department_id: int, day: date, priority: int,
                        include_virtual: bool) -> int:
    """Waiting tokens that would be served before a brand-new token of this priority."""
    q = select(func.count()).select_from(m.Token).where(
        m.Token.department_id == department_id, m.Token.token_date == day,
        m.Token.status == m.TokenStatus.WAITING, m.Token.priority <= int(priority))
    if not include_virtual:
        q = q.where(m.Token.queue_type == m.QueueType.PHYSICAL)
    return db.scalar(q) or 0


def position_in_queue(db: Session, token: m.Token) -> int:
    """1-based position among WAITING tokens in the token's own queue."""
    physical = token.queue_type == m.QueueType.PHYSICAL
    order_col = m.Token.checked_in_at if physical else m.Token.issued_at
    my_time = token.checked_in_at if physical else token.issued_at
    ahead = db.scalar(
        select(func.count()).select_from(m.Token).where(
            m.Token.department_id == token.department_id, m.Token.token_date == token.token_date,
            m.Token.queue_type == token.queue_type, m.Token.status == m.TokenStatus.WAITING,
            m.Token.id != token.id,
            or_(m.Token.priority < token.priority,
                and_(m.Token.priority == token.priority,
                     or_(order_col < my_time, and_(order_col == my_time, m.Token.id < token.id)))))
    ) or 0
    return ahead + 1


# --------------------------------------------------------------------------- #
# Token creation (virtual booking, walk-in QR, reception)
# --------------------------------------------------------------------------- #
def _create_token(db: Session, *, patient: m.Patient, department_id: int, source: m.TokenSource,
                  priority: int, reason: Optional[str],
                  check_in_method: Optional[m.CheckInMethod] = None,
                  station: Optional[m.QRStation] = None,
                  staff: Optional[m.StaffUser] = None) -> m.Token:
    """
    check_in_method None  -> VIRTUAL token: gets a reporting window (when to be at the hospital)
    check_in_method given -> created directly in the PHYSICAL queue (walk-in / reception)
    """
    if not patient.is_active:
        raise Forbidden("This patient account is disabled")

    # Lock the department row: serialises issuance so numbers never collide
    dept = db.execute(
        select(m.Department).where(m.Department.id == department_id).with_for_update()
    ).scalar_one_or_none()
    if dept is None:
        raise NotFound("Department not found")
    hospital = _hospital_of(db, dept)
    if not dept.is_active or not hospital.is_active:
        raise Conflict("This department is not accepting patients")

    now = now_utc()
    day = local_today(now)
    last_number = db.scalar(
        select(func.coalesce(func.max(m.Token.token_number), 0)).where(
            m.Token.department_id == dept.id, m.Token.token_date == day))
    if dept.max_daily_tokens is not None and last_number >= dept.max_daily_tokens:
        raise Conflict("Today's token limit for this department has been reached")

    physical = check_in_method is not None
    counts = queue_counts(db, dept.id, day)
    ahead = _count_ahead_of_new(db, dept.id, day, priority, include_virtual=not physical)
    wait = estimate_wait_minutes(dept, ahead, counts.doctors_available)

    token = m.Token(
        token_number=last_number + 1, token_date=day, patient_id=patient.id, department_id=dept.id,
        priority=int(priority), status=m.TokenStatus.WAITING, reason=reason, source=source,
        queue_type=m.QueueType.PHYSICAL if physical else m.QueueType.VIRTUAL,
        issued_at=now, position_at_issue=ahead, predicted_wait_minutes=wait,
        virtual_queue_length_at_issue=counts.virtual_waiting,
        physical_queue_length_at_issue=counts.physical_waiting,
        doctors_available_at_issue=counts.doctors_available,
    )
    if physical:
        token.checked_in_at = now
        token.check_in_method = check_in_method
        token.qr_station_id = station.id if station else None
        token.checked_in_by_id = staff.id if staff else None
        token.physical_queue_length_at_checkin = counts.physical_waiting
        token.expected_call_at = now + timedelta(minutes=wait)
    else:
        plan = eta.plan_report_window(dept, hospital, wait, now)
        if plan is None:
            raise Conflict("There isn't enough time left today to see new patients. "
                           "Please try again tomorrow, or come in and use the walk-in QR.")
        token.expected_call_at = plan.expected_call_at
        token.report_by_at = plan.report_by_at
        token.report_deadline_at = plan.report_deadline_at

    try:
        with db.begin_nested():   # savepoint: a failed insert must not poison the outer transaction
            db.add(token)
            db.flush()
    except IntegrityError:
        raise Conflict("You already have an active token in this department today")

    # --- tell the patient ---
    if physical:
        ctx = notify.context_for(token, dept, hospital, position=ahead + 1, wait_minutes=wait)
        notify.enqueue(db, token, NT.CHECKED_IN, ctx)
    else:
        ctx = notify.context_for(token, dept, hospital, position=ahead + 1, wait_minutes=wait)
        notify.enqueue(db, token, NT.TOKEN_ISSUED, ctx)
        notify.schedule_report_notifications(db, token, ctx, now)
    return token


def issue_virtual_token(db: Session, patient: m.Patient, department_id: int,
                        reason: Optional[str] = None) -> m.Token:
    """Remote booking. Patients cannot choose a priority - only staff can raise it."""
    return _create_token(db, patient=patient, department_id=department_id,
                         source=m.TokenSource.APP, priority=m.TokenPriority.NORMAL, reason=reason)


# --------------------------------------------------------------------------- #
# QR verification
# --------------------------------------------------------------------------- #
def _load_station(db: Session, qr_payload: str, purpose: m.QRPurpose) -> m.QRStation:
    """Resolve + verify a scanned payload. One generic error so QR contents can't be probed."""
    public_id, _ = qr_codes.parse_payload(qr_payload)
    station = db.scalar(select(m.QRStation).where(
        m.QRStation.public_id == public_id, m.QRStation.purpose == purpose))
    if station is None or not qr_codes.verify_payload(qr_payload, station):
        raise InvalidQR("Invalid or expired QR code. Ask reception to refresh the screen and scan again.")
    return station


def get_station_for_staff(db: Session, staff: m.StaffUser, public_id: str) -> m.QRStation:
    station = db.scalar(select(m.QRStation).where(m.QRStation.public_id == public_id))
    if station is None:
        raise NotFound("QR station not found")
    assert_staff_access(staff, station.hospital_id)
    return station


# --------------------------------------------------------------------------- #
# Check-in: virtual -> physical
# --------------------------------------------------------------------------- #
def _lock_token(db: Session, *, public_id: Optional[str] = None,
                token_id: Optional[int] = None) -> m.Token:
    q = select(m.Token).with_for_update()
    q = q.where(m.Token.public_id == public_id) if public_id else q.where(m.Token.id == token_id)
    token = db.execute(q).scalar_one_or_none()
    if token is None:
        raise NotFound("Token not found")
    return token


def _check_in(db: Session, token: m.Token, method: m.CheckInMethod,
              station: Optional[m.QRStation] = None, staff: Optional[m.StaffUser] = None,
              notification: m.NotificationType = NT.CHECKED_IN) -> m.Token:
    if token.queue_type == m.QueueType.PHYSICAL:
        raise Conflict("This token has already been checked in")
    if token.status != m.TokenStatus.WAITING:
        raise Conflict(f"This token is {token.status.value} and cannot be checked in")
    if token.token_date != local_today():
        raise Conflict("This token is from a previous day")

    dept = db.get(m.Department, token.department_id)
    counts = queue_counts(db, token.department_id, token.token_date)
    ahead = _count_ahead_of_new(db, token.department_id, token.token_date, token.priority,
                                include_virtual=False)
    wait = estimate_wait_minutes(dept, ahead, counts.doctors_available)
    now = now_utc()

    token.queue_type = m.QueueType.PHYSICAL
    token.checked_in_at = now
    token.check_in_method = method
    token.qr_station_id = station.id if station else None
    token.checked_in_by_id = staff.id if staff else None
    token.physical_queue_length_at_checkin = counts.physical_waiting
    token.predicted_wait_minutes = wait
    token.expected_call_at = now + timedelta(minutes=wait)
    db.flush()

    notify.cancel_pending(db, token.id)       # "report now / last call" no longer apply
    ctx = notify.context_for(token, dept, _hospital_of(db, dept), position=ahead + 1, wait_minutes=wait)
    notify.enqueue(db, token, notification, ctx)
    return token


def check_in_with_dynamic_qr(db: Session, patient: m.Patient, token_public_id: str,
                             qr_payload: str) -> m.Token:
    """Patient scans the rotating QR that is shown only on a staff screen."""
    token = _lock_token(db, public_id=token_public_id)
    if token.patient_id != patient.id:
        raise Forbidden("This token belongs to another patient")
    station = _load_station(db, qr_payload, m.QRPurpose.CHECK_IN)
    dept = db.get(m.Department, token.department_id)
    if station.hospital_id != dept.hospital_id or station.department_id not in (None, dept.id):
        raise InvalidQR("This QR code cannot be used for this token")
    return _check_in(db, token, m.CheckInMethod.DYNAMIC_QR, station=station)


def check_in_by_staff(db: Session, staff: m.StaffUser, method: m.CheckInMethod, *,
                      token_public_id: Optional[str] = None,
                      token_id: Optional[int] = None) -> m.Token:
    """Staff scans the patient's static token QR (TOKEN_QR_SCAN) or presses 'arrived' (MANUAL)."""
    token = _lock_token(db, public_id=token_public_id, token_id=token_id)
    assert_staff_access(staff, _get_department(db, token.department_id).hospital_id)
    return _check_in(db, token, method, staff=staff)


# --------------------------------------------------------------------------- #
# Physical-queue entry without a virtual token
# --------------------------------------------------------------------------- #
def join_via_walkin_qr(db: Session, patient: m.Patient, qr_payload: str,
                       department_id: Optional[int] = None, reason: Optional[str] = None) -> m.Token:
    """Patient scans a walk-in QR at the hospital and lands directly in the physical queue."""
    station = _load_station(db, qr_payload, m.QRPurpose.WALK_IN)
    if station.department_id is not None:
        if department_id not in (None, station.department_id):
            raise BadRequest("This QR code belongs to a different department")
        target_id = station.department_id
    else:
        if department_id is None:
            raise BadRequest("This QR covers the whole hospital - choose a department")
        target_id = department_id
    if _get_department(db, target_id).hospital_id != station.hospital_id:
        raise BadRequest("That department is not part of this hospital")
    return _create_token(db, patient=patient, department_id=target_id,
                         source=m.TokenSource.WALKIN_QR, priority=m.TokenPriority.NORMAL,
                         reason=reason, check_in_method=m.CheckInMethod.WALKIN_QR, station=station)


def register_at_reception(db: Session, staff: m.StaffUser, *, department_id: int, priority: int,
                          reason: Optional[str], patient_id: Optional[int] = None,
                          full_name: Optional[str] = None, phone: Optional[str] = None) -> m.Token:
    """Staff registers a patient standing at the desk (any priority, incl. emergency)."""
    dept = _get_department(db, department_id)
    assert_staff_access(staff, dept.hospital_id)

    if patient_id is not None:
        patient = db.get(m.Patient, patient_id)
        if patient is None:
            raise NotFound("Patient not found")
    else:
        phone = _normalize_phone(phone or "")
        if not phone or not (full_name or "").strip():
            raise BadRequest("Provide patient_id, or full_name and phone")
        patient = db.scalar(select(m.Patient).where(m.Patient.phone == phone))
        if patient is None:
            try:
                with db.begin_nested():
                    patient = m.Patient(full_name=full_name.strip(), phone=phone)
                    db.add(patient)
                    db.flush()
            except IntegrityError:   # created by someone else a moment ago
                patient = db.scalar(select(m.Patient).where(m.Patient.phone == phone))
    token = _create_token(db, patient=patient, department_id=dept.id,
                          source=m.TokenSource.RECEPTION, priority=priority, reason=reason,
                          check_in_method=m.CheckInMethod.MANUAL, staff=staff)
    if token.priority == int(m.TokenPriority.EMERGENCY):   # same transaction as the token
        db.add(m.Alert(hospital_id=dept.hospital_id, department_id=dept.id,
                       alert_type=m.AlertType.EMERGENCY_TOKEN, severity=m.AlertSeverity.CRITICAL,
                       message=f"Emergency token {dept.code}-{token.token_number:03d} registered at reception."))
        db.flush()
    return token


# --------------------------------------------------------------------------- #
# Serving patients: call next -> start -> complete, or mark absent
# --------------------------------------------------------------------------- #
def _next_physical_query(department_id: int, day: date):
    return (select(m.Token)
            .where(m.Token.department_id == department_id, m.Token.token_date == day,
                   m.Token.queue_type == m.QueueType.PHYSICAL,
                   m.Token.status == m.TokenStatus.WAITING)
            .order_by(m.Token.priority, m.Token.checked_in_at, m.Token.id)
            .limit(1))


def peek_next_patient(db: Session, staff: m.StaffUser, department_id: int) -> Optional[m.Token]:
    dept = _get_department(db, department_id)
    assert_staff_access(staff, dept.hospital_id)
    return db.scalars(_next_physical_query(dept.id, local_today())).first()


def call_next_patient(db: Session, staff: m.StaffUser, department_id: int,
                      doctor_id: int) -> m.Token:
    """
    Next patient = first WAITING token in the PHYSICAL queue, ordered by
    (priority, checked_in_at, id). SKIP LOCKED keeps concurrent doctors from colliding.
    """
    dept = _get_department(db, department_id)
    assert_staff_access(staff, dept.hospital_id)

    # Lock the doctor row so one doctor cannot be handed two patients by racing requests
    doctor = db.execute(
        select(m.Doctor).where(m.Doctor.id == doctor_id).with_for_update()).scalar_one_or_none()
    if doctor is None or doctor.department_id != dept.id or not doctor.is_active:
        raise NotFound("Doctor not found in this department")
    if doctor.status != m.DoctorStatus.AVAILABLE:
        raise Conflict(f"Doctor is {doctor.status.value.replace('_', ' ')}")

    day = local_today()
    busy = db.scalar(select(func.count()).select_from(m.Token).where(
        m.Token.doctor_id == doctor.id, m.Token.token_date == day,
        m.Token.status.in_((m.TokenStatus.CALLED, m.TokenStatus.IN_CONSULTATION))))
    if busy:
        raise Conflict("This doctor already has a patient - start/complete them or mark them absent first")

    token = db.scalars(_next_physical_query(dept.id, day).with_for_update(skip_locked=True)).first()
    if token is None:
        raise NotFound("No patients waiting in the physical queue")

    now = now_utc()
    token.status = m.TokenStatus.CALLED
    token.called_at = now
    token.doctor_id = doctor.id
    db.flush()

    ctx = notify.context_for(token, dept, _hospital_of(db, dept), doctor=doctor)
    notify.enqueue(db, token, NT.CALLED, ctx)
    # If they haven't reached the room in a couple of minutes, nudge them again
    notify.enqueue(db, token, NT.CALL_REMINDER, ctx,
                   send_at=now + timedelta(minutes=settings.call_reminder_minutes))
    return token


def _staff_token(db: Session, staff: m.StaffUser, token_id: int) -> m.Token:
    token = _lock_token(db, token_id=token_id)
    assert_staff_access(staff, _get_department(db, token.department_id).hospital_id)
    return token


def start_consultation(db: Session, staff: m.StaffUser, token_id: int) -> m.Token:
    token = _staff_token(db, staff, token_id)
    if token.status != m.TokenStatus.CALLED:
        raise Conflict(f"Only a called patient can be started (token is {token.status.value})")
    token.status = m.TokenStatus.IN_CONSULTATION
    token.consultation_started_at = now_utc()
    db.flush()
    notify.cancel_pending(db, token.id)       # the 'you are being called' nudge is moot
    return token


def complete_consultation(db: Session, staff: m.StaffUser, token_id: int) -> m.Token:
    token = _staff_token(db, staff, token_id)
    if token.status != m.TokenStatus.IN_CONSULTATION:
        raise Conflict(f"Only a patient in consultation can be completed (token is {token.status.value})")
    return _finish(db, token, m.TokenStatus.COMPLETED)


def mark_absent(db: Session, staff: m.StaffUser, token_id: int) -> Tuple[m.Token, str]:
    """
    The doctor called the patient and they didn't come ("patient is gone").
      1st time (up to MAX_ABSENT_RECALLS): back into the physical queue behind everyone waiting
      after that:                          NO_SHOW - the token is closed
    Returns (token, "requeued" | "no_show").
    """
    token = _staff_token(db, staff, token_id)
    if token.status != m.TokenStatus.CALLED:
        raise Conflict(f"Only a called patient can be marked absent (token is {token.status.value})")
    dept = db.get(m.Department, token.department_id)
    hospital = _hospital_of(db, dept)
    notify.cancel_pending(db, token.id)
    token.absence_count += 1

    if token.absence_count <= settings.max_absent_recalls:
        counts = queue_counts(db, dept.id, token.token_date)
        token.status = m.TokenStatus.WAITING
        token.called_at = None
        token.doctor_id = None
        token.checked_in_at = now_utc()          # joins the back of the line (same priority)
        token.physical_queue_length_at_checkin = counts.physical_waiting
        db.flush()
        ctx = notify.context_for(token, dept, hospital, position=position_in_queue(db, token))
        notify.enqueue(db, token, NT.REQUEUED, ctx)
        return token, "requeued"

    _finish(db, token, m.TokenStatus.NO_SHOW)
    notify.enqueue(db, token, NT.TOKEN_LAPSED, notify.context_for(token, dept, hospital))
    return token, "no_show"


def reinstate_no_show(db: Session, staff: m.StaffUser, token_id: int) -> m.Token:
    """
    A patient marked NO_SHOW turns up later the same day: staff put them back.
    Virtual -> checked in now (joins the physical queue by arrival time); physical -> back of the line.
    """
    token = _staff_token(db, staff, token_id)
    if token.status != m.TokenStatus.NO_SHOW:
        raise Conflict(f"Only a no-show token can be reinstated (token is {token.status.value})")
    if token.token_date != local_today():
        raise Conflict("Only today's tokens can be reinstated")

    db.execute(delete(m.QueueHistory).where(m.QueueHistory.token_id == token.id))  # will be rewritten when finished
    try:
        with db.begin_nested():
            token.status = m.TokenStatus.WAITING
            token.absence_count = 0
            if token.queue_type == m.QueueType.VIRTUAL:
                db.flush()
                _check_in(db, token, m.CheckInMethod.MANUAL, staff=staff, notification=NT.REINSTATED)
            else:
                dept = db.get(m.Department, token.department_id)
                token.called_at = None
                token.doctor_id = None
                token.checked_in_at = now_utc()
                db.flush()
                ctx = notify.context_for(token, dept, _hospital_of(db, dept),
                                         position=position_in_queue(db, token))
                notify.enqueue(db, token, NT.REINSTATED, ctx)
            db.flush()
    except IntegrityError:
        raise Conflict("This patient already has another active token in this department")
    return token


def cancel_token(db: Session, patient: m.Patient, token_public_id: str) -> m.Token:
    token = _lock_token(db, public_id=token_public_id)
    if token.patient_id != patient.id:
        raise Forbidden("This token belongs to another patient")
    if token.status != m.TokenStatus.WAITING:
        raise Conflict(f"A {token.status.value.replace('_', ' ')} token cannot be cancelled")
    return _finish(db, token, m.TokenStatus.CANCELLED)


# --------------------------------------------------------------------------- #
# Background jobs (called by services/scheduler.py; every function accepts `now` for testing)
# --------------------------------------------------------------------------- #
def lapse_overdue_virtual_tokens(db: Session, now: Optional[datetime] = None) -> int:
    """
    Virtual patients who did not report to the hospital by report_deadline_at -> NO_SHOW.
    Their slot disappears from the queue and everyone behind them moves up.
    """
    now = aware(now) or now_utc()
    overdue = db.scalars(
        select(m.Token)
        .where(m.Token.queue_type == m.QueueType.VIRTUAL, m.Token.status == m.TokenStatus.WAITING,
               m.Token.report_deadline_at.is_not(None), m.Token.report_deadline_at < now)
        .order_by(m.Token.report_deadline_at).limit(200)
        .with_for_update(skip_locked=True)
    ).all()
    for token in overdue:
        dept = db.get(m.Department, token.department_id)
        _finish(db, token, m.TokenStatus.NO_SHOW)
        notify.enqueue(db, token, NT.TOKEN_LAPSED, notify.context_for(token, dept, _hospital_of(db, dept)))
    return len(overdue)


def refresh_report_times(db: Session, now: Optional[datetime] = None) -> int:
    """
    The estimate moves as the queue moves (doctors on break, long consultations, no-shows...).
    Re-plan every virtual token that has not reached its reporting time yet. If the reporting time
    shifts by at least REPORT_RESCHEDULE_THRESHOLD_MINUTES the token is updated, its reminders are
    rescheduled and the patient is told. The patient always gets at least MIN_REPORT_NOTICE_MINUTES.
    """
    now = aware(now) or now_utc()
    day = local_today(now)
    threshold = timedelta(minutes=settings.report_reschedule_threshold_minutes)
    changed = 0

    dept_ids = db.scalars(select(m.Token.department_id).where(
        m.Token.token_date == day, m.Token.queue_type == m.QueueType.VIRTUAL,
        m.Token.status == m.TokenStatus.WAITING).distinct()).all()

    for dept_id in dept_ids:
        dept = db.get(m.Department, dept_id)
        hospital = _hospital_of(db, dept)
        counts = queue_counts(db, dept_id, day)
        waiting = db.scalars(
            select(m.Token)
            .where(m.Token.department_id == dept_id, m.Token.token_date == day,
                   m.Token.queue_type == m.QueueType.VIRTUAL, m.Token.status == m.TokenStatus.WAITING)
            .order_by(m.Token.priority, m.Token.issued_at, m.Token.id)).all()

        for index, snapshot in enumerate(waiting):
            by = aware(snapshot.report_by_at)
            if by is None or by <= now:
                continue                       # already inside the reporting window: don't move the goalposts
            # everyone in front of them in the virtual queue + everyone already at the hospital
            wait = estimate_wait_minutes(dept, index + counts.physical_waiting, counts.doctors_available)
            plan = eta.plan_report_window(dept, hospital, wait, now)
            if plan is None:
                continue                       # can't be re-planned before closing: keep what they were told

            token = db.execute(select(m.Token).where(m.Token.id == snapshot.id)
                               .with_for_update(skip_locked=True)).scalar_one_or_none()
            if token is None or token.status != m.TokenStatus.WAITING or token.queue_type != m.QueueType.VIRTUAL:
                continue                       # changed under us (checked in / cancelled)

            token.predicted_wait_minutes = wait
            token.expected_call_at = plan.expected_call_at
            if abs(plan.report_by_at - aware(token.report_by_at)) < threshold:
                continue                       # small drift: keep the promise, don't spam

            previous = token.report_by_at
            token.report_by_at = plan.report_by_at
            token.report_deadline_at = plan.report_deadline_at
            db.flush()
            notify.cancel_pending(db, token.id, notify.REPORT_TYPES)
            ctx = notify.context_for(token, dept, hospital, wait_minutes=wait, previous_report_by=previous)
            notify.enqueue(db, token, NT.REPORT_TIME_CHANGED, ctx)
            notify.schedule_report_notifications(db, token, ctx, now)
            changed += 1
    return changed


def close_stale_tokens(db: Session) -> int:
    """
    Housekeeping for tokens left over from earlier days that are still 'active'.
    Virtual & never arrived -> NO_SHOW; anything else -> CANCELLED.
    """
    stale = db.scalars(
        select(m.Token).where(m.Token.token_date < local_today(), m.Token.status.in_(ACTIVE))
        .with_for_update(skip_locked=True)).all()
    for token in stale:
        never_came = (token.queue_type == m.QueueType.VIRTUAL and token.status == m.TokenStatus.WAITING)
        _finish(db, token, m.TokenStatus.NO_SHOW if never_came else m.TokenStatus.CANCELLED)
    return len(stale)


# --------------------------------------------------------------------------- #
# Finishing a token -> queue_history row (training data for the AI/ML engine)
# --------------------------------------------------------------------------- #
def _finish(db: Session, token: m.Token, status: m.TokenStatus) -> m.Token:
    token.status = status
    if status == m.TokenStatus.COMPLETED:
        token.completed_at = now_utc()
    db.flush()
    notify.cancel_pending(db, token.id)       # nothing scheduled for a closed token is true any more
    _write_history(db, token)
    return token


def _write_history(db: Session, token: m.Token) -> None:
    local_issue = aware(token.issued_at).astimezone(ZoneInfo(settings.timezone))
    completed = token.status == m.TokenStatus.COMPLETED
    db.add(m.QueueHistory(
        token_id=token.id, department_id=token.department_id, doctor_id=token.doctor_id,
        visit_date=token.token_date, day_of_week=local_issue.weekday(), hour_of_day=local_issue.hour,
        priority=token.priority, source=token.source, final_status=token.status,
        virtual_queue_length_at_issue=token.virtual_queue_length_at_issue or 0,
        physical_queue_length_at_issue=token.physical_queue_length_at_issue or 0,
        physical_queue_length_at_checkin=token.physical_queue_length_at_checkin,
        doctors_available_at_issue=token.doctors_available_at_issue or 0,
        # Targets are only meaningful for visits that actually happened
        arrival_delay_minutes=minutes_between(token.issued_at, token.checked_in_at) if completed else None,
        physical_wait_minutes=minutes_between(token.checked_in_at, token.consultation_started_at) if completed else None,
        wait_minutes=minutes_between(token.issued_at, token.consultation_started_at) if completed else None,
        consultation_minutes=minutes_between(token.consultation_started_at, token.completed_at) if completed else None,
    ))
    db.flush()


# --------------------------------------------------------------------------- #
# Read models
# --------------------------------------------------------------------------- #
def _next_action(token: m.Token) -> str:
    """One plain-language sentence telling the patient what to do right now."""
    S, Q = m.TokenStatus, m.QueueType
    if token.status == S.WAITING and token.queue_type == Q.VIRTUAL:
        return (f"Report to the hospital by {fmt_time(token.report_by_at)} and scan the check-in QR at "
                f"reception. Your token lapses at {fmt_time(token.report_deadline_at)} if you haven't "
                f"checked in.")
    if token.status == S.WAITING:
        return "You're checked in. Stay near the department - you'll be called."
    if token.status == S.CALLED:
        return "You've been called - please go to the doctor now."
    if token.status == S.IN_CONSULTATION:
        return "You're with the doctor."
    if token.status == S.NO_SHOW:
        return "This token was closed because you weren't present. Book a new token or ask at reception."
    return f"This token is {token.status.value.replace('_', ' ')}."


def token_status(db: Session, public_id: str) -> dict:
    """Public status of a token (the target of the patient's static QR). No personal data."""
    token = db.scalar(select(m.Token).where(m.Token.public_id == public_id))
    if token is None:
        raise NotFound("Token not found")
    dept = db.get(m.Department, token.department_id)
    hospital = _hospital_of(db, dept)
    position = wait = None
    if token.status == m.TokenStatus.WAITING:
        counts = queue_counts(db, dept.id, token.token_date)
        position = position_in_queue(db, token)
        ahead = position - 1
        if token.queue_type == m.QueueType.VIRTUAL:
            ahead += counts.physical_waiting   # everyone already on site will be seen first
        wait = estimate_wait_minutes(dept, ahead, counts.doctors_available)
    return {"token": token, "department": dept, "hospital": hospital, "position": position,
            "estimated_wait_minutes": wait, "next_action": _next_action(token)}


def my_tokens_today(db: Session, patient: m.Patient) -> list:
    return list(db.scalars(select(m.Token).where(
        m.Token.patient_id == patient.id, m.Token.token_date == local_today())
        .order_by(m.Token.issued_at.desc())))


def department_queue(db: Session, staff: m.StaffUser, department_id: int) -> dict:
    """Dashboard view: both queues in serving order, plus who is currently being served."""
    dept = _get_department(db, department_id)
    assert_staff_access(staff, dept.hospital_id)
    day = local_today()

    def fetch(*conditions, order):
        return db.execute(
            select(m.Token, m.Patient.full_name)
            .join(m.Patient, m.Patient.id == m.Token.patient_id)
            .where(m.Token.department_id == dept.id, m.Token.token_date == day, *conditions)
            .order_by(*order)).all()

    return {
        "department": dept,
        "counts": queue_counts(db, dept.id, day),
        "physical": fetch(m.Token.queue_type == m.QueueType.PHYSICAL,
                          m.Token.status == m.TokenStatus.WAITING,
                          order=(m.Token.priority, m.Token.checked_in_at, m.Token.id)),
        "virtual": fetch(m.Token.queue_type == m.QueueType.VIRTUAL,
                         m.Token.status == m.TokenStatus.WAITING,
                         order=(m.Token.priority, m.Token.issued_at, m.Token.id)),
        "in_progress": fetch(m.Token.status.in_((m.TokenStatus.CALLED, m.TokenStatus.IN_CONSULTATION)),
                             order=(m.Token.called_at, m.Token.id)),
    }