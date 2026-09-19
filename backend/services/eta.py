"""
ETA logic for the queue.

This is deliberately a simple, explainable placeholder (people-ahead * avg consult time,
split across available doctors) - swap the body of estimate_wait_minutes() for a real ML
call once ml/ has a trained model; nothing else in the service layer needs to change, since
callers only ever see a wait in minutes.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from config import settings
from database import models as m
from services.timeutil import aware, local_today


def estimate_wait_minutes(dept: m.Department, ahead: int, doctors_available: int) -> int:
    """Minutes until a token with `ahead` people in front of it is likely to be called."""
    doctors = max(1, doctors_available)  # never divide by zero just because everyone's on break
    return max(0, round((ahead * dept.avg_consult_minutes) / doctors))


@dataclass
class ReportPlan:
    expected_call_at: datetime   # when we think they'll actually be seen
    report_by_at: datetime       # "be at the hospital by this time"
    report_deadline_at: datetime  # check in by this time or the token lapses


def plan_report_window(dept: m.Department, hospital: m.Hospital, wait_minutes: int,
                       now: datetime) -> Optional[ReportPlan]:
    """
    Work backwards from the estimated call time to a reporting window:
      report_by_at       = expected_call_at, pulled earlier by a check-in buffer
                            (never less than settings.min_report_notice_minutes from now)
      report_deadline_at = report_by_at + the department's grace period

    Returns None if report_deadline_at would fall after the hospital closes today - the
    caller (queue_service / refresh_report_times) treats that as "can't fit this in today".
    """
    now = aware(now)
    expected_call_at = now + timedelta(minutes=wait_minutes)
    buffer_minutes = max(settings.min_report_notice_minutes, dept.avg_consult_minutes)
    earliest = now + timedelta(minutes=settings.min_report_notice_minutes)
    report_by_at = max(earliest, expected_call_at - timedelta(minutes=buffer_minutes))
    report_deadline_at = report_by_at + timedelta(minutes=dept.report_grace_minutes)

    if hospital.closes_at is not None:
        tz = ZoneInfo(settings.timezone)
        closes_local = datetime.combine(local_today(now), hospital.closes_at, tzinfo=tz)
        if report_deadline_at > closes_local:
            return None

    return ReportPlan(expected_call_at, report_by_at, report_deadline_at)
