"""
Runs the periodic jobs the queue depends on. Uses APScheduler inside the FastAPI process -
fine for one instance; if you ever run multiple backend replicas, move this to a separate
worker process so jobs don't fire once per replica (the SKIP LOCKED queries in queue_service
keep the *work* safe either way, but you'd still be querying N times over for nothing).

pip install apscheduler
"""
import logging

from apscheduler.schedulers.background import BackgroundScheduler

from database.db import session_scope
from services import notify, queue_service

log = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone="UTC")


def _run(label: str, fn) -> None:
    """Each job gets its own session/transaction; one job failing shouldn't affect the next tick."""
    try:
        with session_scope() as db:
            count = fn(db)
            if count:
                log.info("%s: %s", label, count)
    except Exception:
        log.exception("%s failed", label)


def start() -> None:
    scheduler.add_job(lambda: _run("dispatch_due", notify.dispatch_due),
                      "interval", seconds=10, id="dispatch_due", replace_existing=True)
    scheduler.add_job(lambda: _run("lapse_overdue_virtual_tokens", queue_service.lapse_overdue_virtual_tokens),
                      "interval", minutes=1, id="lapse_overdue", replace_existing=True)
    scheduler.add_job(lambda: _run("refresh_report_times", queue_service.refresh_report_times),
                      "interval", minutes=2, id="refresh_report_times", replace_existing=True)
    scheduler.add_job(lambda: _run("close_stale_tokens", queue_service.close_stale_tokens),
                      "cron", hour=0, minute=5, id="close_stale_tokens", replace_existing=True)
    scheduler.start()
    log.info("Scheduler started: dispatch_due(10s), lapse_overdue(1m), refresh_report_times(2m), "
             "close_stale_tokens(daily 00:05 UTC)")


def stop() -> None:
    scheduler.shutdown(wait=False)
