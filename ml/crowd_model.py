"""
Future Crowd Prediction Model (Module 2).
Predicts future department crowd levels across 15m, 30m, and 60m horizons.
Classifies congestion into database enum values: 'low', 'medium', 'high', 'critical'.
"""
from __future__ import annotations
from datetime import datetime
from pathlib import Path
from typing import Any, Dict
import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from .eta_model import normalize_dept

NUMERIC_FEATURES = [
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

CATEGORICAL_FEATURES = ["department"]

def build_crowd_pipeline() -> Pipeline:
    preprocessor = ColumnTransformer(
        [
            ("num", "passthrough", NUMERIC_FEATURES),
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL_FEATURES),
        ]
    )
    model = RandomForestRegressor(
        n_estimators=100, max_depth=12, min_samples_leaf=2, random_state=42, n_jobs=-1
    )
    return Pipeline([("pre", preprocessor), ("rf", model)])

def train_crowd_model(df: pd.DataFrame) -> Pipeline:
    df = df.copy()
    df["department"] = df["department"].apply(normalize_dept)
    X = df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y = df["crowd_count"]
    pipe = build_crowd_pipeline()
    pipe.fit(X, y)
    return pipe

def classify_congestion(predicted_crowd: float, capacity: int = 20) -> str:
    ratio = predicted_crowd / max(float(capacity), 1.0)
    if ratio < 0.65:
        return "low"
    elif ratio < 1.05:
        return "medium"
    elif ratio < 1.50:
        return "high"
    else:
        return "critical"

def predict_crowd(model: Pipeline, features: Dict[str, Any], capacity: int = 20) -> Dict[str, Any]:
    dept_raw = features.get("department") or features.get("department_code") or "General Medicine"
    dept_norm = normalize_dept(str(dept_raw))

    cur_q = float(features.get("current_queue", 0))
    exp_15 = float(features.get("expected_arrivals_15min", 0))
    exp_30 = float(features.get("expected_arrivals_30min", exp_15 * 1.8))
    exp_60 = float(features.get("expected_arrivals_60min", exp_30 * 1.8))
    hist_avg = float(features.get("historical_average_arrivals", exp_60 * 0.9))
    doctors = max(1, int(features.get("doctors_available", 1)))
    avg_srv = max(1.0, float(features.get("average_service_time", 10.0)))
    
    now = datetime.now()
    h_val = features.get("hour")
    hour = int(h_val if h_val is not None else now.hour)
    d_val = features.get("day_of_week")
    dow = int(d_val if d_val is not None else now.weekday())

    row = {
        "expected_arrivals_15min": exp_15,
        "expected_arrivals_30min": exp_30,
        "expected_arrivals_60min": exp_60,
        "historical_average_arrivals": hist_avg,
        "current_queue": cur_q,
        "doctors_available": doctors,
        "average_service_time": avg_srv,
        "hour": hour,
        "day_of_week": dow,
        "department": dept_norm,
    }

    df_in = pd.DataFrame([row])
    raw_pred_60 = float(model.predict(df_in)[0])
    pred_60 = max(0, int(round(raw_pred_60)))

    service_rate_per_min = doctors / avg_srv
    pred_15 = max(0, int(round(cur_q + exp_15 - (service_rate_per_min * 15))))
    pred_30 = max(0, int(round(cur_q + exp_30 - (service_rate_per_min * 30))))

    congestion = classify_congestion(pred_60, capacity)

    alert = None
    if congestion == "critical":
        alert = f"CRITICAL: {dept_norm} projected to exceed capacity ({pred_60}/{capacity}) in 60 minutes."
    elif congestion == "high":
        alert = f"WARNING: High demand approaching {dept_norm} ({pred_60} expected patients)."

    return {
        "predicted_crowd": pred_60,
        "congestion": congestion,
        "capacity": capacity,
        "department": dept_norm,
        "timeline": {
            "current": int(cur_q),
            "plus_15m": pred_15,
            "plus_30m": pred_30,
            "plus_60m": pred_60,
        },
        "alert": alert,
    }

def save_model(model: Pipeline, path: Path | str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, target)

def load_model(path: Path | str) -> Pipeline:
    return joblib.load(path)
