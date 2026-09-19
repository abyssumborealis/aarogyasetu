"""Shared request/response schemas for the check-in, walk-in and queue endpoints."""
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from database import models as m


class TokenOut(BaseModel):
    """Public view of a token, returned by every endpoint below."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: str
    display_code: str
    token_number: int
    token_date: date
    patient_id: int
    department_id: int
    doctor_id: Optional[int] = None
    priority: int
    status: m.TokenStatus
    reason: Optional[str] = None
    queue_type: m.QueueType
    source: m.TokenSource
    checked_in_at: Optional[datetime] = None
    check_in_method: Optional[m.CheckInMethod] = None
    issued_at: datetime
    called_at: Optional[datetime] = None
    consultation_started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    predicted_wait_minutes: Optional[int] = None


# ---- check-in ---------------------------------------------------------- #
class CheckInScanRequest(BaseModel):
    """Patient's app scans the rotating QR shown on the staff check-in screen."""
    payload: str = Field(..., description="Raw QR payload, e.g. '<public_id>.<otp>'")
    token_public_id: str = Field(..., description="The patient's own token QR (public_id)")


class StaffScanRequest(BaseModel):
    """Staff scans the patient's static token QR."""
    token_public_id: str


class ManualCheckInRequest(BaseModel):
    """Staff clicks 'arrived' next to a token in the dashboard."""
    token_id: int


# ---- walk-in ------------------------------------------------------------ #
class WalkInScanRequest(BaseModel):
    """Patient scans a printed/screen walk-in QR; creates a new physical token directly."""
    payload: str
    patient_id: int
    department_id: Optional[int] = Field(
        None, description="Required only if the QR station is hospital-wide (department_id is NULL)."
    )
    reason: Optional[str] = None


class ReceptionWalkInRequest(BaseModel):
    """Staff registers a walk-in (or emergency) at the desk."""
    patient_id: int
    department_id: int
    reason: Optional[str] = None
    priority: Literal[0, 1, 2] = 2  # 0=emergency, 1=priority, 2=normal


# ---- queue ---------------------------------------------------------------- #
class CallNextRequest(BaseModel):
    doctor_id: Optional[int] = None