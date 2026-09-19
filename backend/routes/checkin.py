"""
Check-in and walk-in endpoints.

Check-in  (moves an EXISTING virtual token into the physical queue):
    POST /checkin/scan         patient's app scans the staff rotating QR   (dynamic_qr)
    POST /checkin/staff-scan   staff scans the patient's static token QR   (token_qr_scan)
    POST /checkin/manual       staff clicks "arrived" in the dashboard     (manual)

Walk-in  (creates a NEW token, straight into the physical queue, no virtual step):
    POST /walkin/scan          patient scans a walk-in QR                  (walkin_qr)
    POST /walkin/reception     staff registers a walk-in / emergency       (manual + reception)

All of these set `checked_in_at`, which is the token's time-of-arrival at the hospital.
"""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import models as m
from database.qr_codes import parse_payload, verify_payload
from routes.deps import assert_staff_scope, get_current_staff, get_db
from routes.queue import allocate_token_number, lock_department
from routes.schemas import (
    CheckInScanRequest,
    ManualCheckInRequest,
    ReceptionWalkInRequest,
    StaffScanRequest,
    TokenOut,
    WalkInScanRequest,
)

router = APIRouter(tags=["check-in"])


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _load_station(db: Session, payload: str, purpose: m.QRPurpose) -> m.QRStation:
    public_id, _ = parse_payload(payload)
    station = db.execute(
        select(m.QRStation).where(m.QRStation.public_id == public_id)
    ).scalar_one_or_none()
    if station is None or station.purpose != purpose:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown or invalid QR code.")
    if not verify_payload(payload, station):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "QR code has expired or is invalid. Ask staff to refresh the screen and scan again.",
        )
    return station


def _load_today_virtual_waiting_token(db: Session, token_public_id: str) -> m.Token:
    token = db.execute(
        select(m.Token).where(m.Token.public_id == token_public_id)
    ).scalar_one_or_none()
    if token is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Token not found.")
    if token.token_date != date.today():
        raise HTTPException(status.HTTP_409_CONFLICT, "This token is not for today.")
    if token.queue_type != m.QueueType.VIRTUAL or token.status != m.TokenStatus.WAITING:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Token cannot be checked in (queue_type={token.queue_type.value}, "
            f"status={token.status.value}).",
        )
    return token


def _apply_check_in(
    db: Session,
    token: m.Token,
    method: m.CheckInMethod,
    *,
    station: m.QRStation | None = None,
    staff_id: int | None = None,
) -> None:
    token.queue_type = m.QueueType.PHYSICAL
    token.checked_in_at = datetime.now(timezone.utc)  # <- time of arrival
    token.check_in_method = method
    if station is not None:
        token.qr_station_id = station.id
    if staff_id is not None:
        token.checked_in_by_id = staff_id
    db.flush()


def _create_walkin_token(
    db: Session,
    *,
    department: m.Department,
    patient_id: int,
    source: m.TokenSource,
    check_in_method: m.CheckInMethod,
    reason: str | None,
    priority: int = int(m.TokenPriority.NORMAL),
    station_id: int | None = None,
    staff_id: int | None = None,
) -> m.Token:
    now = datetime.now(timezone.utc)
    token = m.Token(
        token_number=allocate_token_number(db, department.id, date.today()),
        patient_id=patient_id,
        department_id=department.id,
        reason=reason,
        priority=priority,
        queue_type=m.QueueType.PHYSICAL,
        source=source,
        status=m.TokenStatus.WAITING,
        checked_in_at=now,  # walk-ins arrive at the moment they're issued a token
        check_in_method=check_in_method,
        qr_station_id=station_id,
        checked_in_by_id=staff_id,
    )
    db.add(token)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # Most likely uq_tokens_one_active_per_patient_dept: patient already has a
        # waiting/called/in-consultation token in this department today.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This patient already has an active token in this department today.",
        )
    db.refresh(token)
    return token


# --------------------------------------------------------------------------- #
# check-in: existing virtual token -> physical queue
# --------------------------------------------------------------------------- #
@router.post("/checkin/scan", response_model=TokenOut)
def checkin_scan(body: CheckInScanRequest, db: Session = Depends(get_db)) -> m.Token:
    """Patient's phone scans the rotating QR on the staff check-in screen."""
    station = _load_station(db, body.payload, m.QRPurpose.CHECK_IN)
    token = _load_today_virtual_waiting_token(db, body.token_public_id)

    if token.department.hospital_id != station.hospital_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This QR code belongs to a different hospital.")
    if station.department_id is not None and station.department_id != token.department_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This QR code is for a different department.")

    _apply_check_in(db, token, m.CheckInMethod.DYNAMIC_QR, station=station)
    db.commit()
    db.refresh(token)
    return token


@router.post("/checkin/staff-scan", response_model=TokenOut)
def checkin_staff_scan(
    body: StaffScanRequest,
    db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> m.Token:
    """Staff scans the patient's own static token QR (e.g. printed slip or their phone)."""
    token = _load_today_virtual_waiting_token(db, body.token_public_id)
    assert_staff_scope(staff, token.department.hospital_id)

    _apply_check_in(db, token, m.CheckInMethod.TOKEN_QR_SCAN, staff_id=staff.id)
    db.commit()
    db.refresh(token)
    return token


@router.post("/checkin/manual", response_model=TokenOut)
def checkin_manual(
    body: ManualCheckInRequest,
    db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> m.Token:
    """Staff clicks "arrived" for a token they're looking at in the dashboard — no scan."""
    token = db.get(m.Token, body.token_id)
    if token is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Token not found.")
    if token.token_date != date.today():
        raise HTTPException(status.HTTP_409_CONFLICT, "This token is not for today.")
    if token.queue_type != m.QueueType.VIRTUAL or token.status != m.TokenStatus.WAITING:
        raise HTTPException(status.HTTP_409_CONFLICT, "Token cannot be checked in.")
    assert_staff_scope(staff, token.department.hospital_id)

    _apply_check_in(db, token, m.CheckInMethod.MANUAL, staff_id=staff.id)
    db.commit()
    db.refresh(token)
    return token


# --------------------------------------------------------------------------- #
# walk-in: brand-new token, straight into the physical queue
# --------------------------------------------------------------------------- #
@router.post("/walkin/scan", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def walkin_scan(body: WalkInScanRequest, db: Session = Depends(get_db)) -> m.Token:
    """Patient scans a walk-in QR (poster or screen) and joins the physical queue directly."""
    station = _load_station(db, body.payload, m.QRPurpose.WALK_IN)

    department_id = station.department_id or body.department_id
    if department_id is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "This QR code is hospital-wide; department_id is required.",
        )

    department = lock_department(db, department_id)
    if department.hospital_id != station.hospital_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This QR code belongs to a different hospital.")
    if not department.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This department is not accepting tokens.")

    patient = db.get(m.Patient, body.patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found.")

    return _create_walkin_token(
        db,
        department=department,
        patient_id=body.patient_id,
        source=m.TokenSource.WALKIN_QR,
        check_in_method=m.CheckInMethod.WALKIN_QR,
        reason=body.reason,
        station_id=station.id,
    )


@router.post("/walkin/reception", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def walkin_reception(
    body: ReceptionWalkInRequest,
    db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> m.Token:
    """Staff registers a walk-in (or an emergency) directly at the desk."""
    department = lock_department(db, body.department_id)
    assert_staff_scope(staff, department.hospital_id)
    if not department.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This department is not accepting tokens.")

    patient = db.get(m.Patient, body.patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found.")

    token = _create_walkin_token(
        db,
        department=department,
        patient_id=body.patient_id,
        source=m.TokenSource.RECEPTION,
        check_in_method=m.CheckInMethod.MANUAL,
        reason=body.reason,
        priority=body.priority,
        staff_id=staff.id,
    )

    if token.priority == int(m.TokenPriority.EMERGENCY):
        db.add(
            m.Alert(
                hospital_id=department.hospital_id,
                department_id=department.id,
                alert_type=m.AlertType.EMERGENCY_TOKEN,
                severity=m.AlertSeverity.CRITICAL,
                message=f"Emergency token {token.display_code} registered at reception.",
            )
        )
        db.commit()

    return token