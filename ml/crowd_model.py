"""Future Crowd Prediction Model (Module 2)."""
from __future__ import annotations
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

NUMERIC = [
    "expected_arrivals_15min",
    "expected_arrivals_30min",
    "expected_arrivals_60min",
    "historical_average_arrivals",
    "current_queue",
    "doctors_available",
    "average_service_time",
    "hour",
    "day_of_week",
]
CATEGORICAL = ["department"]

DEPT_CAPACITIES = {
    "General Medicine": 28,
    "Cardiology": 22,
    "Orthopaedics": 18,
    "Paediatrics": 16,
    "Dermatology": 14,
}

def classify_congestion(crowd: float, capacity: int) -> str:
    """Returns lowercase congestion string matching models.CongestionLevel."""
    ratio = crowd / max(1.0, float(capacity))
    if ratio < 0.6:
        return "low"
    elif ratio < 1.1:
        return "medium"
    elif ratio < 1.5:
        return "high"
    return "critical"

def _pipeline() -> Pipeline:
    pre = ColumnTransformer(
        [
            ("num", "passthrough", NUMERIC),
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL),
        ]
    )
    model = RandomForestRegressor(n_estimators=100, max_depth=12, random_state=42, n_jobs=-1)
    return Pipeline([("pre", pre), ("rf", model)])

def train_crowd_model(df: pd.DataFrame) -> Pipeline:
    X = df[NUMERIC + CATEGORICAL]
    y = df["crowd_count"]
    pipe = _pipeline()
    pipe.fit(X, y)
    return pipe

def predict_crowd(model: Pipeline, features: dict) -> dict:
    dept = features.get("department", "General Medicine")
    cur_q = float(features.get("current_queue", 0))
    exp_15 = float(features.get("expected_arrivals_15min", 0))
    exp_30 = float(features.get("expected_arrivals_30min", 0))
    exp_60 = float(features.get("expected_arrivals_60min", 0))
    docs = max(1, int(features.get("doctors_available", 1)))
    avg_srv = max(1.0, float(features.get("average_service_time", 10.0)))
    
    row = {
        "expected_arrivals_15min": exp_15,
        "expected_arrivals_30min": exp_30,
        "expected_arrivals_60min": exp_60,
        "historical_average_arrivals": float(features.get("historical_average_arrivals", exp_60 * 0.9)),
        "current_queue": cur_q,
        "doctors_available": docs,
        "average_service_time": avg_srv,
        "hour": int(features.get("hour", 10)),
        "day_of_week": int(features.get("day_of_week", 2)),
        "department": dept,
    }

    X = pd.DataFrame([row])
    pred_crowd = max(0, int(round(float(model.predict(X)[0]))))

    capacity = DEPT_CAPACITIES.get(dept, 20)
    congestion = classify_congestion(pred_crowd, capacity)

    srv_per_15m = (docs * 15.0) / avg_srv
    plus_15 = max(0, int(round(cur_q + exp_15 - srv_per_15m)))
    plus_30 = max(0, int(round(cur_q + exp_30 - (srv_per_15m * 2))))

    return {
        "predicted_crowd": pred_crowd,
        "congestion": congestion,
        "confidence": 0.88,
        "model_version": "rf-crowd-v1.0",
        "timeline": {
            "current": int(cur_q),
            "plus_15m": plus_15,
            "plus_30m": plus_30,
            "plus_60m": pred_crowd,
        },
        "alert": f"High congestion expected for {dept} ({pred_crowd} patients vs {capacity} cap)." if congestion in {"high", "critical"} else None
    }
