"""
Patient-facing endpoints. All business rules live in services/queue_service.py - this file
only parses the request, calls the service, commits, and returns the result.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import models as m
from routes.deps import get_current_patient, get_db
from routes.schemas import (
    DynamicQrCheckInRequest,
    IssueVirtualTokenRequest,
    TokenOut,
    TokenStatusOut,
    WalkInScanRequest,
)
from services import queue_service as qs

router = APIRouter(prefix="/tokens", tags=["tokens"])


@router.post("/virtual", response_model=TokenOut, status_code=201)
def book_virtual_token(
    body: IssueVirtualTokenRequest,
    db: Session = Depends(get_db),
    patient: m.Patient = Depends(get_current_patient),
) -> m.Token:
    """Remote booking - creates a virtual token with a reporting window already scheduled."""
    token = qs.issue_virtual_token(db, patient, body.department_id, reason=body.reason)
    db.commit()
    db.refresh(token)
    return token


@router.post("/check-in/scan", response_model=TokenOut)
def check_in_scan(
    body: DynamicQrCheckInRequest,
    db: Session = Depends(get_db),
    patient: m.Patient = Depends(get_current_patient),
) -> m.Token:
    """Patient's app scans the rotating QR on the staff check-in screen."""
    token = qs.check_in_with_dynamic_qr(db, patient, body.token_public_id, body.qr_payload)
    db.commit()
    db.refresh(token)
    return token


@router.post("/walk-in/scan", response_model=TokenOut, status_code=201)
def walk_in_scan(
    body: WalkInScanRequest,
    db: Session = Depends(get_db),
    patient: m.Patient = Depends(get_current_patient),
) -> m.Token:
    """Patient scans a walk-in QR and lands directly in the physical queue."""
    token = qs.join_via_walkin_qr(
        db, patient, body.qr_payload, department_id=body.department_id, reason=body.reason
    )
    db.commit()
    db.refresh(token)
    return token


@router.post("/{token_public_id}/cancel", response_model=TokenOut)
def cancel_token(
    token_public_id: str,
    db: Session = Depends(get_db),
    patient: m.Patient = Depends(get_current_patient),
) -> m.Token:
    token = qs.cancel_token(db, patient, token_public_id)
    db.commit()
    db.refresh(token)
    return token


@router.get("/{public_id}/status", response_model=TokenStatusOut)
def get_token_status(public_id: str, db: Session = Depends(get_db)):
    """Public status lookup - what the patient's static QR/status link points at. No auth."""
    return qs.token_status(db, public_id)


@router.get("/mine/today", response_model=list[TokenOut])
def my_tokens_today(
    db: Session = Depends(get_db),
    patient: m.Patient = Depends(get_current_patient),
) -> list:
    return qs.my_tokens_today(db, patient)
