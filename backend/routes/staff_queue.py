"""
Staff-facing endpoints. All business rules live in services/queue_service.py - this file
only parses the request, calls the service, commits, and returns the result.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import models as m
from routes.deps import get_current_staff, get_db
from routes.schemas import (
    CallNextRequest,
    DepartmentOut,
    DepartmentQueueOut,
    ManualCheckInRequest,
    QueueCountsOut,
    QueueTokenOut,
    ReceptionRegisterRequest,
    StaffScanRequest,
    TokenOut,
)
from services import queue_service as qs

router = APIRouter(tags=["staff"])


# --------------------------------------------------------------------------- #
# departments
# --------------------------------------------------------------------------- #
@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(
    db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> list:
    """Departments the current staff member can see - their own hospital, or all if super admin."""
    from sqlalchemy import select
    query = select(m.Department).where(m.Department.is_active.is_(True))
    if staff.hospital_id is not None:
        query = query.where(m.Department.hospital_id == staff.hospital_id)
    return list(db.scalars(query.order_by(m.Department.name)))


# --------------------------------------------------------------------------- #
# check-in / walk-in
# --------------------------------------------------------------------------- #
@router.post("/checkin/staff-scan", response_model=TokenOut)
def checkin_staff_scan(
    body: StaffScanRequest, db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> m.Token:
    """Staff scans the patient's static token QR."""
    token = qs.check_in_by_staff(db, staff, m.CheckInMethod.TOKEN_QR_SCAN,
                                 token_public_id=body.token_public_id)
    db.commit()
    db.refresh(token)
    return token


@router.post("/checkin/manual", response_model=TokenOut)
def checkin_manual(
    body: ManualCheckInRequest, db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> m.Token:
    """Staff clicks "arrived" for a token in the dashboard - no scan."""
    token = qs.check_in_by_staff(db, staff, m.CheckInMethod.MANUAL, token_id=body.token_id)
    db.commit()
    db.refresh(token)
    return token


@router.post("/walkin/reception", response_model=TokenOut, status_code=201)
def walkin_reception(
    body: ReceptionRegisterRequest, db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> m.Token:
    """Staff registers a walk-in (or emergency) at the desk. patient_id OR full_name+phone."""
    token = qs.register_at_reception(
        db, staff, department_id=body.department_id, priority=body.priority, reason=body.reason,
        patient_id=body.patient_id, full_name=body.full_name, phone=body.phone,
    )
    db.commit()
    db.refresh(token)
    return token


# --------------------------------------------------------------------------- #
# dashboard / serving patients
# --------------------------------------------------------------------------- #
@router.get("/queue/{department_id}", response_model=DepartmentQueueOut)
def department_queue(
    department_id: int, db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> DepartmentQueueOut:
    """
    Both queues in serving order, plus who's currently being served. Flattened here (rather
    than returned as raw ORM rows) so the frontend gets plain {code, patient_name, ...} tokens
    and camelCase counts - queue_service.department_queue() itself returns (Token, full_name)
    row tuples plus a QueueCounts dataclass, neither of which FastAPI can serialize as-is.
    """
    data = qs.department_queue(db, staff, department_id)

    def to_tokens(rows) -> list[QueueTokenOut]:
        return [
            QueueTokenOut(
                id=token.id, code=token.display_code, patient_name=patient_name,
                priority=token.priority, status=token.status, reason=token.reason,
                checked_in_at=token.checked_in_at, called_at=token.called_at,
            )
            for token, patient_name in rows
        ]

    counts = data["counts"]
    return DepartmentQueueOut(
        department=DepartmentOut.model_validate(data["department"]),
        counts=QueueCountsOut(
            physicalWaiting=counts.physical_waiting,
            virtualWaiting=counts.virtual_waiting,
            inProgress=counts.in_progress,
            doctorsAvailable=counts.doctors_available,
        ),
        physical=to_tokens(data["physical"]),
        virtual=to_tokens(data["virtual"]),
        in_progress=to_tokens(data["in_progress"]),
    )


@router.get("/queue/{department_id}/next", response_model=Optional[TokenOut])
def peek_next_patient(
    department_id: int, db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
):
    """Read-only peek at who'd be called next - does not call them."""
    return qs.peek_next_patient(db, staff, department_id)


@router.post("/queue/{department_id}/call-next", response_model=TokenOut)
def call_next_patient(
    department_id: int, body: CallNextRequest, db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> m.Token:
    token = qs.call_next_patient(db, staff, department_id, body.doctor_id)
    db.commit()
    db.refresh(token)
    return token


@router.post("/queue/tokens/{token_id}/start", response_model=TokenOut)
def start_consultation(
    token_id: int, db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> m.Token:
    token = qs.start_consultation(db, staff, token_id)
    db.commit()
    db.refresh(token)
    return token


@router.post("/queue/tokens/{token_id}/complete", response_model=TokenOut)
def complete_consultation(
    token_id: int, db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> m.Token:
    """Doctor marks the patient as done/gone."""
    token = qs.complete_consultation(db, staff, token_id)
    db.commit()
    db.refresh(token)
    return token


@router.post("/queue/tokens/{token_id}/absent")
def mark_absent(
    token_id: int, db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
):
    """Called patient didn't show up. Requeued once, then NO_SHOW (see settings.max_absent_recalls)."""
    token, outcome = qs.mark_absent(db, staff, token_id)
    db.commit()
    db.refresh(token)
    return {"token": TokenOut.model_validate(token), "outcome": outcome}


@router.post("/queue/tokens/{token_id}/reinstate", response_model=TokenOut)
def reinstate_no_show(
    token_id: int, db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> m.Token:
    """A no-show patient turns up later the same day - staff put them back in the queue."""
    token = qs.reinstate_no_show(db, staff, token_id)
    db.commit()
    db.refresh(token)
    return token