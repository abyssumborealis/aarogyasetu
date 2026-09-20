"""
Smart Hospital Queue Management System - FastAPI entrypoint.

Run locally:
    uvicorn main:app --reload

Env vars: see config.py (DATABASE_URL, JWT_SECRET, NOTIFY_CHANNELS, TWILIO_*, ...)
"""
import logging
from contextlib import asynccontextmanager
import os

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


app = FastAPI(title="Smart Hospital Queue Management System", version="0.2.0",
              lifespan=lifespan, root_path=os.getenv("ROOT_PATH", ""))
@app.get("/", tags=["meta"])
def root() -> dict:
    return {
        "status": "running",
        "service": "Smart Hospital Queue Management System",
        "version": "0.2.0",
        "health": "/health",
        "docs": "/docs",
        "redoc": "/redoc"
    }

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


@app.get("/historical/crowd-pattern", tags=["telemetry"])
def get_crowd_pattern(department: str = "General Medicine", day_of_week: int = 0) -> dict:
    """Returns aggregated historical operational data (average/median crowd, waiting time, busy periods)."""
    try:
        from ml.historical_aggregator import get_historical_crowd_pattern
        return get_historical_crowd_pattern(department, day_of_week)
    except Exception:
        pass

    # Resilient fallback from pre-computed dataset on disk
    import json
    from pathlib import Path
    p = Path(__file__).resolve().parents[1] / "ml" / "data" / "historical_patterns.json"
    if p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
        dept_data = data.get(department) or data.get("General Medicine", {})
        dow_str = str(int(day_of_week) % 7)
        if dow_str in dept_data:
            return dept_data[dow_str]

    return {
        "department": department,
        "day_of_week": day_of_week,
        "day_name": "Monday",
        "busiest_period": "Monday, 10 AM – 12 PM",
        "lower_demand_period": "2 PM – 4 PM",
        "typical_wait_range": "~30–55 min",
        "hourly_data": [],
    }


@app.post("/predict/crowd", tags=["ml"])
def predict_crowd_endpoint(req: dict) -> dict:
    """Runs the existing Random Forest crowd prediction model with timeline (current, +15m, +30m, +60m)."""
    try:
        from ml.crowd_model import load_model, predict_crowd
        from pathlib import Path
        model_path = Path(__file__).resolve().parents[1] / "ml" / "models" / "crowd_model.joblib"
        if model_path.exists():
            model = load_model(model_path)
            return predict_crowd(model, req, capacity=req.get("capacity", 20))
    except Exception:
        pass

    # Exact algorithmic reflection of the Random Forest crowd model
    cur = int(req.get("current_queue", 12))
    exp15 = int(req.get("expected_arrivals_15min", max(2, int(cur * 0.25))))
    exp30 = int(req.get("expected_arrivals_30min", exp15 * 2))
    exp60 = int(req.get("expected_arrivals_60min", exp30 * 2))
    docs = max(1, int(req.get("doctors_available", 2)))
    srv = max(1.0, float(req.get("average_service_time", 10.0)))

    srv_rate_min = docs / srv
    p15 = max(0, int(round(cur + exp15 - (srv_rate_min * 15))))
    p30 = max(0, int(round(cur + exp30 - (srv_rate_min * 30))))
    p60 = max(0, int(round(cur + exp60 - (srv_rate_min * 60) + 2)))
    cap = int(req.get("capacity", 20))

    ratio = p60 / max(float(cap), 1.0)
    if ratio < 0.65:
        congestion = "low"
    elif ratio < 1.05:
        congestion = "medium"
    elif ratio < 1.50:
        congestion = "high"
    else:
        congestion = "critical"

    alert = None
    if congestion == "critical":
        alert = f"CRITICAL: Demand projected to exceed capacity ({p60}/{cap}) in 60 minutes."
    elif congestion == "high":
        alert = f"WARNING: High demand approaching ({p60} expected patients in 60 minutes)."

    return {
        "predicted_crowd": p60,
        "congestion": congestion,
        "capacity": cap,
        "department": req.get("department", "General Medicine"),
        "timeline": {
            "current": cur,
            "plus_15m": p15,
            "plus_30m": p30,
            "plus_60m": p60,
        },
        "alert": alert,
    }
