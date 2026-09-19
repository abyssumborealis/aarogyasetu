"""
Smart Hospital Queue Management System - FastAPI entrypoint.

Run locally:
    uvicorn main:app --reload

Env vars: see config.py (DATABASE_URL, JWT_SECRET, NOTIFY_CHANNELS, TWILIO_*, ...)
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from database.db import engine
from database.models import Base
from routes import staff_queue, tokens
from services import scheduler, sms
from services.errors import QueueError

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dev convenience only: creates any missing tables on startup.
    # Once you wire up Alembic, replace this with real migrations and drop this call.
    Base.metadata.create_all(bind=engine)

    sms.setup()          # registers the Twilio sender with services/notify.py, if configured
    scheduler.start()    # dispatch_due / lapse_overdue_virtual_tokens / refresh_report_times / close_stale_tokens
    yield
    scheduler.stop()


app = FastAPI(
    title="Smart Hospital Queue Management System",
    version="0.2.0",
    lifespan=lifespan,
)

# Wide open for local dev with the patient/admin frontends on different ports.
# Lock this down to your real frontend origins before deploying.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(QueueError)
def handle_queue_error(request: Request, exc: QueueError) -> JSONResponse:
    """Every service-layer error (NotFound, Conflict, Forbidden, ...) becomes a clean JSON response."""
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


app.include_router(tokens.router)
app.include_router(staff_queue.router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok"}
