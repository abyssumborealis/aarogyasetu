"""
Central app settings, read from environment variables (and a local .env in dev).

Every knob used by services/queue_service.py and services/notify.py lives here so the
business logic never hardcodes a number - tune queue behaviour without touching code.
"""
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- core ---------------------------------------------------------------- #
    database_url: str = "sqlite:///./queue.db"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 60 * 12

    # IANA timezone used for "today", report windows, and all times shown to patients/staff.
    timezone: str = "Asia/Kolkata"

    # --- reporting window (virtual queue "when to arrive") -------------------------------- #
    # Patient is always given at least this much notice before report_by_at, even if the
    # queue estimate says "come immediately".
    min_report_notice_minutes: int = 20
    # Send the REPORT_REMINDER this many minutes before report_by_at.
    report_reminder_minutes: int = 15
    # How long after report_by_at the LAST_CALL reminder fires (must be < the department's
    # report_grace_minutes, since report_deadline_at = report_by_at + report_grace_minutes).
    last_call_minutes: int = 10
    # If the re-planned report_by_at drifts by less than this, don't re-notify the patient.
    report_reschedule_threshold_minutes: int = 10

    # --- requested consultation time ("I'd like to be seen around 4 PM") ------------------------ #
    # Width of the arrival window the patient is given, e.g. "arrive between 3:40 and 3:50 PM".
    arrival_window_minutes: int = 10
    # How many days ahead a consultation time can be requested (0 = same day only).
    max_advance_days: int = 7

    # --- calling patients ------------------------------------------------------------------ #
    # Nudge a called-but-not-arrived patient again after this many minutes.
    call_reminder_minutes: int = 3
    # A called patient who doesn't show up gets requeued this many times before NO_SHOW.
    max_absent_recalls: int = 1

    # --- notifications ----------------------------------------------------------------------- #
    # Which channels are actually enabled. Anything not listed here is never sent, even if
    # notify.enqueue() creates a row for it - dispatch_due() only acts on enabled channels
    # reaching a real sender. Default is in_app only, so nothing goes out until you opt in.
    notify_channels: List[str] = ["in_app"]

    # --- SMS (Twilio) -------------------------------------------------------------------------- #
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""


settings = Settings()
