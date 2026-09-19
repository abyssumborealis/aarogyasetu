"""Shared request/response schemas for the check-in, walk-in and queue endpoints."""
from datetime import date, datetime, timedelta
from typing import Literal, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, computed_field

from config import settings
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
    # Virtual tokens: when to be at the hospital. requested_consultation_at is set for time-slot bookings.
    requested_consultation_at: Optional[datetime] = None
    expected_call_at: Optional[datetime] = None
    report_by_at: Optional[datetime] = None
    report_deadline_at: Optional[datetime] = None

    @computed_field  # end of the arrival window; the window is report_by_at .. this
    @property
    def arrival_window_end_at(self) -> Optional[datetime]:
        if self.report_by_at is None or self.requested_consultation_at is None:
            return None
        return self.report_by_at + timedelta(minutes=settings.arrival_window_minutes)


class DepartmentBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    code: str


class HospitalBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class TokenStatusOut(BaseModel):
    """Public status lookup (GET /tokens/{public_id}/status). No personal data."""
    model_config = ConfigDict(from_attributes=True)

    token: TokenOut
    department: DepartmentBrief
    hospital: HospitalBrief
    position: Optional[int] = None
    estimated_wait_minutes: Optional[int] = None
    next_action: str


# ---- remote booking ---------------------------------------------------- #
class IssueVirtualTokenRequest(BaseModel):
    department_id: int
    reason: Optional[str] = None
    desired_consultation_at: Optional[datetime] = Field(
        None,
        description="Time the patient wants to be seen. Naive values are hospital-local time. "
                    "Omit to book 'now' (window comes from the live queue).",
    )


class ArrivalPreviewRequest(BaseModel):
    """'Check availability' - read-only, nothing is reserved."""
    department_id: int
    desired_consultation_at: datetime = Field(
        ..., description="Naive values are hospital-local time, e.g. '2026-09-21T16:00'."
    )


class ArrivalPreviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    available: bool
    reason: Optional[str] = None            # in_the_past | too_far | too_soon | outside_hours | no_doctors |
                                            # department_full | already_booked | inactive
    message: str
    department_id: int
    requested_consultation_at: datetime
    timezone: str                           # IANA name; format every time below in this zone
    arrive_from: Optional[datetime] = None
    arrive_until: Optional[datetime] = None
    report_deadline_at: Optional[datetime] = None
    expected_consultation_at: Optional[datetime] = None
    predicted_wait_minutes: Optional[int] = None
    congestion_level: Optional[m.CongestionLevel] = None
    confidence: Optional[float] = None
    model_version: Optional[str] = None
    earliest_available_at: Optional[datetime] = None


# ---- check-in ---------------------------------------------------------- #
class DynamicQrCheckInRequest(BaseModel):
    """Patient's app scans the rotating QR shown on the staff check-in screen."""
    token_public_id: str
    qr_payload: str = Field(
        ..., validation_alias=AliasChoices("qr_payload", "payload"),
        description="Raw QR payload, e.g. '<public_id>.<otp>'",
    )


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
    qr_payload: str = Field(..., validation_alias=AliasChoices("qr_payload", "payload"))
    patient_id: Optional[int] = Field(None, description="Ignored - the patient comes from the session.")
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


class ReceptionRegisterRequest(BaseModel):
    """Staff registers a patient at reception."""
    department_id: int
    priority: Literal[0, 1, 2] = 2
    reason: Optional[str] = None
    patient_id: Optional[int] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None

# ---- queue ---------------------------------------------------------------- #
class CallNextRequest(BaseModel):
    doctor_id: Optional[int] = None
# ---- staff queue responses --------------------------------------------- #

class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hospital_id: int
    name: str
    code: str
    description: Optional[str] = None
    avg_consult_minutes: int
    max_daily_tokens: Optional[int] = None
    report_grace_minutes: int
    is_active: bool


class QueueTokenOut(BaseModel):
    id: int
    code: str
    patient_name: str
    priority: int
    status: m.TokenStatus
    reason: Optional[str] = None
    checked_in_at: Optional[datetime] = None
    called_at: Optional[datetime] = None


class QueueCountsOut(BaseModel):
    physicalWaiting: int
    virtualWaiting: int
    inProgress: int
    doctorsAvailable: int


class DepartmentQueueOut(BaseModel):
    department: DepartmentOut
    counts: QueueCountsOut
    physical: list[QueueTokenOut]
    virtual: list[QueueTokenOut]
    in_progress: list[QueueTokenOut]