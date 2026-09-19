"""
Arrival-time prediction: "the patient wants to be seen around T - when should they arrive?"

This module is the ML contract. queue_services.py builds an `ArrivalFeatures` from the database
and calls `predict_arrival_for_consultation()`; nothing else in the backend knows how the answer
is produced. To ship the trained model, replace `_predict_wait()` below (or the body of
`predict_arrival_for_consultation`) - the signature and the two dataclasses are the contract and
must stay as they are.

    ArrivalFeatures  ->  predict_arrival_for_consultation()  ->  ArrivalPrediction

What the model has to answer: given the load around the requested time, how long will a patient
who walks in at reception then wait before being called (`expected_wait_minutes`)? The arrival
window is plain arithmetic on top of that (arrive early enough to absorb the wait).

Pure function: no database, no clock, no I/O. Everything it needs arrives in `ArrivalFeatures`.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Tuple

from config import settings
from database import models as m

MODEL_VERSION = "mock-heuristic-v0"      # <- becomes the trained model's version string


@dataclass(frozen=True)
class ArrivalFeatures:
    """Everything known about the requested slot. All datetimes are timezone-aware UTC."""
    department_id: int
    desired_at: datetime                 # when the patient wants to be seen
    now: datetime
    local_hour: int                      # hour of `desired_at` in the hospital's timezone (0-23)
    day_of_week: int                     # 0 = Monday, in the hospital's timezone
    days_ahead: int                      # 0 = same day
    avg_consult_minutes: int             # department's fallback service time
    doctors_on_shift: int                # doctors expected to be working at `desired_at` (>= 1)
    booked_nearby: int                   # other time-slot bookings within +/-30 min of `desired_at`
    physical_waiting_now: int            # patients already on site (only counted for imminent slots, else 0)


@dataclass(frozen=True)
class ArrivalPrediction:
    arrive_from: datetime                # start of the arrival window
    arrive_until: datetime               # end of the arrival window
    expected_wait_minutes: int           # wait between arriving and being called
    expected_call_at: datetime           # when we expect them to actually be called
    congestion_level: m.CongestionLevel
    confidence: float                    # 0..1
    model_version: str


def predict_arrival_for_consultation(features: ArrivalFeatures) -> ArrivalPrediction:
    wait, congestion, confidence = _predict_wait(features)

    # Arrive early enough to absorb the wait, rounded down to 5 minutes so the times read cleanly.
    window = timedelta(minutes=settings.arrival_window_minutes)
    arrive_from = _floor_5min(features.desired_at - timedelta(minutes=wait) - window)
    arrive_until = arrive_from + window
    return ArrivalPrediction(
        arrive_from=arrive_from,
        arrive_until=arrive_until,
        expected_wait_minutes=wait,
        expected_call_at=max(features.desired_at, arrive_until + timedelta(minutes=wait)),
        congestion_level=congestion,
        confidence=confidence,
        model_version=MODEL_VERSION,
    )


def _floor_5min(dt: datetime) -> datetime:
    return dt - timedelta(minutes=dt.minute % 5, seconds=dt.second, microseconds=dt.microsecond)


# =========================================================================== #
#  MOCK IMPLEMENTATION - replace with the trained model.
#  A transparent heuristic that mirrors the shape of the seed data (busy 10:00-13:00) so the
#  UI and API can be built and tested end to end. It is NOT a forecast.
# =========================================================================== #
_PEAK_HOURS = (10, 11, 12)
_PEAK_FACTOR = 1.6
_CHECK_IN_OVERHEAD_MINUTES = 5
_MAX_WAIT_MINUTES = 120


def _predict_wait(f: ArrivalFeatures) -> Tuple[int, m.CongestionLevel, float]:
    load = f.booked_nearby + f.physical_waiting_now
    peak = _PEAK_FACTOR if f.local_hour in _PEAK_HOURS else 1.0
    raw = _CHECK_IN_OVERHEAD_MINUTES + (load * f.avg_consult_minutes / max(1, f.doctors_on_shift)) * peak
    wait = int(round(min(max(raw, 0), _MAX_WAIT_MINUTES)))

    if wait < 15:
        congestion = m.CongestionLevel.LOW
    elif wait < 35:
        congestion = m.CongestionLevel.MEDIUM
    elif wait < 60:
        congestion = m.CongestionLevel.HIGH
    else:
        congestion = m.CongestionLevel.CRITICAL

    confidence = round(max(0.5, 0.8 - 0.03 * f.days_ahead), 2)   # less sure the further out we look
    return wait, congestion, confidence
