"""Shared FastAPI dependencies for the routes package."""
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from database import models as m
from database.db import get_db

__all__ = ["get_db", "get_current_staff", "assert_staff_scope"]


def get_current_staff(
    x_staff_id: int = Header(..., alias="X-Staff-Id"),
    db: Session = Depends(get_db),
) -> m.StaffUser:
    """
    PLACEHOLDER AUTH. Trusts an `X-Staff-Id` header so the endpoints below are runnable
    without wiring up real auth first. Replace with your actual session/JWT dependency
    before this goes anywhere near production — this has no verification whatsoever.
    """
    staff = db.get(m.StaffUser, x_staff_id)
    if staff is None or not staff.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid staff session.")
    return staff


def assert_staff_scope(staff: m.StaffUser, hospital_id: int) -> None:
    """Super admins (hospital_id IS NULL) can act on any hospital; others only their own."""
    if staff.hospital_id is not None and staff.hospital_id != hospital_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this hospital.")