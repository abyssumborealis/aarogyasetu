from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

from database import models as m


class TokenOut(BaseModel):
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
    expected_call_at: Optional[datetime] = None
    report_by_at: Optional[datetime] = None
    report_deadline_at: Optional[datetime] = None
    absence_count: int


class TokenStatusOut(BaseModel):
    """Public status view (services.queue_service.token_status) - no personal data."""
    token: TokenOut
    position: Optional[int] = None
    estimated_wait_minutes: Optional[int] = None
    next_action: str


# ---- requests ------------------------------------------------------------- #
class IssueVirtualTokenRequest(BaseModel):
    department_id: int
    reason: Optional[str] = None


class DynamicQrCheckInRequest(BaseModel):
    token_public_id: str
    qr_payload: str


class StaffScanRequest(BaseModel):
    token_public_id: str


class ManualCheckInRequest(BaseModel):
    token_id: int


class WalkInScanRequest(BaseModel):
    qr_payload: str
    department_id: Optional[int] = None
    reason: Optional[str] = None


class ReceptionRegisterRequest(BaseModel):
    department_id: int
    priority: Literal[0, 1, 2] = 2
    reason: Optional[str] = None
    patient_id: Optional[int] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None


class QueueTokenOut(BaseModel):
    """One row in a department's live queue - flattened from the (Token, patient full_name) tuple."""
    id: int
    code: str
    patient_name: str
    priority: int
    status: m.TokenStatus
    reason: Optional[str] = None
    checked_in_at: Optional[datetime] = None
    called_at: Optional[datetime] = None


class QueueCountsOut(BaseModel):
    """camelCase on purpose - matches what the admin frontend's Dashboard.jsx reads."""
    physicalWaiting: int
    virtualWaiting: int
    inProgress: int
    doctorsAvailable: int


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    code: str
    avg_consult_minutes: int


class DepartmentQueueOut(BaseModel):
    department: DepartmentOut
    counts: QueueCountsOut
    physical: list[QueueTokenOut]
    virtual: list[QueueTokenOut]
    in_progress: list[QueueTokenOut]


class CallNextRequest(BaseModel):
    doctor_id: int