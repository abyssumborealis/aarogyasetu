"""
Notifications (outbox pattern).

* enqueue()  writes rows into `notifications` - immediately, or scheduled for a future `send_at`.
* Reminders for a virtual token (report reminder / report now / last call) are scheduled up front
  and CANCELLED the moment they stop being true (patient checked in, token closed, time changed).
* In-app inbox: rows on the `in_app` channel whose send_at has passed are simply visible to the
  patient (GET /notifications) - no delivery step needed.
* External channels (sms / push / email): dispatch_due() sends due rows with retries.
  Register a real sender with register_sender(); until then only `in_app` is enabled by default
  (NOTIFY_CHANNELS in .env), so nothing is silently "sent" anywhere.

Nothing here commits - callers commit (API routes / scheduler).
"""
import logging
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional, Tuple

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import settings
from database import models as m
from services.timeutil import aware, fmt_time, now_utc

log = logging.getLogger(__name__)

NT = m.NotificationType
CH = m.NotificationChannel
NS = m.NotificationStatus

MAX_ATTEMPTS = 3
RETRY_BACKOFF_MINUTES = (1, 5, 15)

# channel -> callable(notification, patient). Raise to signal failure (it will be retried).
SENDERS: Dict[m.NotificationChannel, Callable[[m.Notification, m.Patient], None]] = {}


def register_sender(channel: m.NotificationChannel, fn: Callable[[m.Notification, m.Patient], None]) -> None:
    """Plug in Twilio / MSG91 / FCM / SMTP etc:  register_sender(NotificationChannel.SMS, my_fn)."""
    SENDERS[channel] = fn


def _channels() -> List[m.NotificationChannel]:
    out = []
    for name in settings.notify_channels:
        try:
            out.append(CH(name))
        except ValueError:
            log.warning("Unknown notification channel %r in NOTIFY_CHANNELS - ignored", name)
    return out or [CH.IN_APP]


# --------------------------------------------------------------------------- #
# Message text
# --------------------------------------------------------------------------- #
def context_for(token: m.Token, dept: m.Department, hospital: m.Hospital, *,
                doctor: Optional[m.Doctor] = None, position: Optional[int] = None,
                wait_minutes: Optional[int] = None, previous_report_by: Optional[datetime] = None) -> dict:
    return {
        "code": f"{dept.code}-{token.token_number:03d}",
        "hospital": hospital.name,
        "department": dept.name,
        "doctor": doctor.full_name if doctor else None,
        "report_by": fmt_time(token.report_by_at),
        "deadline": fmt_time(token.report_deadline_at),
        "expected": fmt_time(token.expected_call_at),
        "previous_report_by": fmt_time(previous_report_by),
        "grace": dept.report_grace_minutes,
        "position": position,
        "wait": wait_minutes,
        "reminder_min": settings.report_reminder_minutes,
        "call_reminder_min": settings.call_reminder_minutes,
    }


def render(ntype: m.NotificationType, c: dict) -> Tuple[str, str]:
    """(title, body) for each notification type."""
    code, where = c["code"], f'{c["hospital"]} ({c["department"]})'
    if ntype == NT.TOKEN_ISSUED:
        return (f"Token {code} booked",
                f"Please be at {where} by {c['report_by']} and scan the check-in QR at reception. "
                f"You'll be seen around {c['expected']}. Your token lapses at {c['deadline']} if you "
                f"haven't checked in. We'll remind you {c['reminder_min']} minutes before.")
    if ntype == NT.REPORT_REMINDER:
        return (f"Leave soon - report by {c['report_by']}",
                f"Your token {code} needs you at {where} by {c['report_by']} "
                f"(in about {c['reminder_min']} minutes).")
    if ntype == NT.REPORT_NOW:
        return ("Please report to the hospital now",
                f"It's time to report to {where}. Scan the check-in QR at reception to confirm you're here. "
                f"Token {code} lapses at {c['deadline']} if you haven't checked in.")
    if ntype == NT.REPORT_LAST_CALL:
        return ("Last call to check in",
                f"Check in by {c['deadline']} or token {code} will be cancelled.")
    if ntype == NT.REPORT_TIME_CHANGED:
        return (f"New reporting time: {c['report_by']}",
                f"Because the queue moved, please report to {where} by {c['report_by']} instead of "
                f"{c['previous_report_by']}. Your token lapses at {c['deadline']} if you haven't checked in.")
    if ntype == NT.CHECKED_IN:
        wait = f" Estimated wait about {c['wait']} min." if c["wait"] is not None else ""
        pos = f"You're number {c['position']} in the queue." if c["position"] else "You're in the queue."
        return (f"Checked in - token {code}", f"{pos}{wait} Please stay near {c['department']}.")
    if ntype == NT.CALLED:
        who = f" Dr. {c['doctor'].removeprefix('Dr. ')}" if c["doctor"] else " the doctor"
        return ("It's your turn", f"Please go to{who} ({c['department']}) now - token {code}.")
    if ntype == NT.CALL_REMINDER:
        return ("You are being called",
                f"Token {code} was called {c['call_reminder_min']} minutes ago. Please go to "
                f"{c['department']} now, or you may be moved back in the queue.")
    if ntype == NT.REQUEUED:
        pos = f" You're now number {c['position']}." if c["position"] else ""
        return ("You missed your call",
                f"You weren't there when token {code} was called, so you've been moved back in the queue.{pos}")
    if ntype == NT.TOKEN_LAPSED:
        return (f"Token {code} closed",
                f"You weren't present when needed, so token {code} was closed. "
                f"You can book a new token any time, or ask at reception.")
    if ntype == NT.REINSTATED:
        pos = f" You're now number {c['position']}." if c["position"] else ""
        return ("You're back in the queue", f"Reception has put token {code} back in the queue.{pos}")
    return ("Update", f"Token {code}")


# --------------------------------------------------------------------------- #
# Creating / cancelling
# --------------------------------------------------------------------------- #
def enqueue(db: Session, token: m.Token, ntype: m.NotificationType, ctx: dict, *,
            send_at: Optional[datetime] = None) -> List[m.Notification]:
    """Queue one message per configured channel. Duplicate pending messages are silently dropped."""
    now = now_utc()
    send_at = aware(send_at) or now
    title, body = render(ntype, ctx)
    created = []
    for channel in _channels():
        immediate_in_app = channel == CH.IN_APP and send_at <= now
        note = m.Notification(
            patient_id=token.patient_id, token_id=token.id, type=ntype, channel=channel,
            title=title[:120], body=body, send_at=send_at,
            # nothing to deliver for an in-app message that is already visible
            status=NS.SENT if immediate_in_app else NS.PENDING,
            sent_at=now if immediate_in_app else None,
        )
        try:
            with db.begin_nested():   # savepoint: a duplicate must not poison the transaction
                db.add(note)
                db.flush()
            created.append(note)
        except IntegrityError:
            continue
    return created


def cancel_pending(db: Session, token_id: int, types: Optional[List[m.NotificationType]] = None) -> int:
    """Withdraw scheduled messages that are no longer true."""
    stmt = (update(m.Notification)
            .where(m.Notification.token_id == token_id, m.Notification.status == NS.PENDING)
            .values(status=NS.CANCELLED))
    if types:
        stmt = stmt.where(m.Notification.type.in_(types))
    return db.execute(stmt.execution_options(synchronize_session=False)).rowcount


REPORT_TYPES = [NT.REPORT_REMINDER, NT.REPORT_NOW, NT.REPORT_LAST_CALL]


def schedule_report_notifications(db: Session, token: m.Token, ctx: dict,
                                  now: Optional[datetime] = None) -> None:
    """Reminder -> 'report now' -> last call, timed off the token's reporting window."""
    now = aware(now) or now_utc()
    by, deadline = aware(token.report_by_at), aware(token.report_deadline_at)
    if by is None or deadline is None:
        return
    reminder_at = by - timedelta(minutes=settings.report_reminder_minutes)
    if reminder_at > now:
        enqueue(db, token, NT.REPORT_REMINDER, ctx, send_at=reminder_at)
    enqueue(db, token, NT.REPORT_NOW, ctx, send_at=by)
    last_call_at = deadline - timedelta(minutes=settings.last_call_minutes)
    if last_call_at > by:
        enqueue(db, token, NT.REPORT_LAST_CALL, ctx, send_at=last_call_at)


# --------------------------------------------------------------------------- #
# Patient inbox (in-app channel)
# --------------------------------------------------------------------------- #
def _inbox_query(patient_id: int, now: datetime):
    return select(m.Notification).where(
        m.Notification.patient_id == patient_id,
        m.Notification.channel == CH.IN_APP,
        m.Notification.status.in_((NS.PENDING, NS.SENT)),
        m.Notification.send_at <= now,
    )


def list_for_patient(db: Session, patient_id: int, *, unread_only: bool = False, limit: int = 50,
                     now: Optional[datetime] = None) -> List[m.Notification]:
    q = _inbox_query(patient_id, aware(now) or now_utc())
    if unread_only:
        q = q.where(m.Notification.read_at.is_(None))
    return list(db.scalars(q.order_by(m.Notification.send_at.desc(), m.Notification.id.desc()).limit(limit)))


def unread_count(db: Session, patient_id: int, now: Optional[datetime] = None) -> int:
    q = _inbox_query(patient_id, aware(now) or now_utc()).where(m.Notification.read_at.is_(None))
    return db.scalar(select(func.count()).select_from(q.subquery())) or 0


def mark_read(db: Session, patient_id: int, notification_id: int) -> Optional[m.Notification]:
    note = db.get(m.Notification, notification_id)
    if note is None or note.patient_id != patient_id:
        return None                       # not yours = not found
    if note.read_at is None:
        note.read_at = now_utc()
    return note


def mark_all_read(db: Session, patient_id: int, now: Optional[datetime] = None) -> int:
    now = aware(now) or now_utc()
    return db.execute(
        update(m.Notification)
        .where(m.Notification.patient_id == patient_id, m.Notification.channel == CH.IN_APP,
               m.Notification.send_at <= now, m.Notification.read_at.is_(None))
        .values(read_at=now)
        .execution_options(synchronize_session=False)
    ).rowcount


# --------------------------------------------------------------------------- #
# Dispatcher (run by the scheduler every few seconds)
# --------------------------------------------------------------------------- #
def dispatch_due(db: Session, now: Optional[datetime] = None, limit: int = 200) -> int:
    """Send every pending notification whose time has come. Returns how many were sent."""
    now = aware(now) or now_utc()
    due = db.scalars(
        select(m.Notification)
        .where(m.Notification.status == NS.PENDING, m.Notification.send_at <= now)
        .order_by(m.Notification.send_at)
        .limit(limit)
        .with_for_update(skip_locked=True)   # several workers can run this safely
    ).all()
    sent = 0
    for note in due:
        if note.channel == CH.IN_APP:        # visible in the inbox already; just record it
            note.status, note.sent_at = NS.SENT, now
            sent += 1
            continue
        sender = SENDERS.get(note.channel)
        try:
            if sender is None:
                raise RuntimeError(f"No sender registered for channel '{note.channel.value}'")
            sender(note, db.get(m.Patient, note.patient_id))
            note.status, note.sent_at = NS.SENT, now
            sent += 1
        except Exception as exc:             # noqa: BLE001 - any provider failure means retry
            note.attempts += 1
            note.last_error = str(exc)[:500]
            if note.attempts >= MAX_ATTEMPTS:
                note.status = NS.FAILED
                log.error("Notification %s failed permanently: %s", note.id, exc)
            else:
                backoff = RETRY_BACKOFF_MINUTES[min(note.attempts - 1, len(RETRY_BACKOFF_MINUTES) - 1)]
                note.send_at = now + timedelta(minutes=backoff)
    db.flush()
    return sent
