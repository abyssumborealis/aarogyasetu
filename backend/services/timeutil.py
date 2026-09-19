"""
Every timestamp is stored in UTC. "Today" and anything shown to a person is in the hospital's
local timezone (config.settings.timezone). This module is the one place that conversion happens.
"""
from datetime import date, datetime
from datetime import timezone as dt_timezone
from typing import Optional
from zoneinfo import ZoneInfo

from config import settings


def now_utc() -> datetime:
    return datetime.now(dt_timezone.utc)


def aware(dt: Optional[datetime]) -> Optional[datetime]:
    """
    Treat a naive datetime as UTC. SQLite drops tzinfo on round-trip (Postgres doesn't), so
    every value coming back out of the DB should be passed through this before comparing or
    formatting it - cheap no-op on Postgres, a real fix on SQLite.
    """
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=dt_timezone.utc)


def local_today(now: Optional[datetime] = None) -> date:
    """The hospital's current local calendar date."""
    now = aware(now) or now_utc()
    return now.astimezone(ZoneInfo(settings.timezone)).date()


def fmt_time(dt: Optional[datetime]) -> Optional[str]:
    """'2:05 PM' in hospital-local time, for messages. None in, None out."""
    dt = aware(dt)
    if dt is None:
        return None
    return dt.astimezone(ZoneInfo(settings.timezone)).strftime("%I:%M %p").lstrip("0")


def minutes_between(a: Optional[datetime], b: Optional[datetime]) -> Optional[float]:
    """b - a, in minutes. None if either side is missing (e.g. token never reached that stage)."""
    a, b = aware(a), aware(b)
    if a is None or b is None:
        return None
    return round((b - a).total_seconds() / 60, 1)
