"""
"Next patient" queries for the physical queue.

Only physical tokens can be called (see ck_tokens_virtual_not_called), and the physical
queue is ordered by priority first, then time of arrival (`checked_in_at`) — this matches
the partial index `ix_tokens_physical_queue`.

    GET  /queue/{department_id}/next        peek at who's next, without changing anything
    POST /queue/{department_id}/call-next   atomically pull the next patient and call them
"""
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import models as m
from routes.deps import assert_staff_scope, get_current_staff, get_db
from routes.schemas import CallNextRequest, TokenOut

router = APIRouter(prefix="/queue", tags=["queue"])


# --------------------------------------------------------------------------- #
# helpers (also used by routes/checkin.py for walk-in token creation)
# --------------------------------------------------------------------------- #
def lock_department(db: Session, department_id: int) -> m.Department:
    """
    Row-lock the department for the duration of the transaction. Used as a simple mutex
    around token-number allocation and calling the next patient, so two concurrent
    requests for the same department can't race each other.

    Note: SQLite ignores FOR UPDATE entirely (fine for single-process dev, not for
    concurrent access) — this is a real lock only on Postgres/MySQL.
    """
    department = db.execute(
        select(m.Department).where(m.Department.id == department_id).with_for_update()
    ).scalar_one_or_none()
    if department is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found.")
    return department


def allocate_token_number(db: Session, department_id: int, token_date: date) -> int:
    """Next token_number for this department/day. Caller must already hold the department lock."""
    last = db.execute(
        select(func.max(m.Token.token_number)).where(
            m.Token.department_id == department_id, m.Token.token_date == token_date
        )
    ).scalar()
    return (last or 0) + 1


def _next_physical_query(department_id: int):
    return (
        select(m.Token)
        .where(
            m.Token.department_id == department_id,
            m.Token.token_date == date.today(),
            m.Token.queue_type == m.QueueType.PHYSICAL,
            m.Token.status == m.TokenStatus.WAITING,
        )
        .order_by(m.Token.priority.asc(), m.Token.checked_in_at.asc())
        .limit(1)
    )


# --------------------------------------------------------------------------- #
# endpoints
# --------------------------------------------------------------------------- #
@router.get("/{department_id}/next", response_model=Optional[TokenOut])
def get_next_patient(department_id: int, db: Session = Depends(get_db)):
    """Read-only peek at whichever physical-queue token would be called next."""
    return db.execute(_next_physical_query(department_id)).scalar_one_or_none()


@router.post("/{department_id}/call-next", response_model=TokenOut)
def call_next_patient(
    department_id: int,
    body: CallNextRequest,
    db: Session = Depends(get_db),
    staff: m.StaffUser = Depends(get_current_staff),
) -> m.Token:
    """Atomically pick the next waiting physical token and mark it CALLED."""
    department = lock_department(db, department_id)
    assert_staff_scope(staff, department.hospital_id)

    token = db.execute(
        _next_physical_query(department_id).with_for_update(skip_locked=True)
    ).scalar_one_or_none()
    if token is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No patients waiting in the physical queue.")

    if body.doctor_id is not None:
        doctor = db.get(m.Doctor, body.doctor_id)
        if doctor is None or doctor.department_id != department_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid doctor for this department.")
        token.doctor_id = body.doctor_id

    token.status = m.TokenStatus.CALLED
    token.called_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(token)
    return token