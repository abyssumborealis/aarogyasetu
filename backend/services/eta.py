# Replace the placeholder in services/eta.py:
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from config import settings
from database import models as m
from services.timeutil import aware, local_today
def estimate_wait_minutes(dept: m.Department, ahead: int, doctors_available: int) -> int:
    """Minutes until a token with `ahead` people in front of it is likely to be called."""
    # 1. Try real ML model
    try:
        from ml.eta_model import load_model, predict_eta
        from pathlib import Path
        model_path = Path(__file__).resolve().parents[1] / "ml" / "models" / "eta_model.joblib"
        if model_path.exists():
            model = load_model(model_path)
            res = predict_eta(model, {
                "department": dept.name,
                "people_ahead": ahead,
                "doctors_available": doctors_available,
                "average_service_time": dept.avg_consult_minutes,
            })
            return res["estimated_wait_minutes"]
    except Exception:
        pass

    # 2. Resilient fallback
    doctors = max(1, doctors_available)
    return max(0, round((ahead * dept.avg_consult_minutes) / doctors))
