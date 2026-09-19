"""
SMS delivery via Twilio, plugged into services/notify.py's outbox.

pip install twilio

Set in .env:
    TWILIO_ACCOUNT_SID=...
    TWILIO_AUTH_TOKEN=...
    TWILIO_FROM_NUMBER=+1...
    NOTIFY_CHANNELS=["in_app","sms"]     # sms must be listed here or dispatch_due() never
                                          # reaches this sender at all

Call setup() once at startup (see main.py). If Twilio isn't configured, setup() logs a
warning and leaves the channel un-registered rather than crashing - dispatch_due() will then
mark any sms row as FAILED after MAX_ATTEMPTS instead of raising.
"""
import logging

from config import settings
from database import models as m

log = logging.getLogger(__name__)

_client = None


def _get_client():
    global _client
    if _client is None:
        from twilio.rest import Client   # imported lazily so twilio is only required if used
        _client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
    return _client


def send_sms(notification: m.Notification, patient: m.Patient) -> None:
    """Raises on failure - services/notify.py's dispatch_due() catches this and retries."""
    if not patient.phone:
        raise RuntimeError(f"Patient {patient.id} has no phone number on file")
    client = _get_client()
    client.messages.create(
        to=patient.phone,
        from_=settings.twilio_from_number,
        body=f"{notification.title}\n{notification.body}",
    )


def setup() -> None:
    """Register the SMS sender if Twilio credentials are present. Call once at startup."""
    from services import notify

    if not (settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_from_number):
        log.warning("Twilio credentials not set - SMS notifications will fail, not send.")
        return
    notify.register_sender(m.NotificationChannel.SMS, send_sms)
