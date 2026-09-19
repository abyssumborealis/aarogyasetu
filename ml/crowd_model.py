from __future__ import annotations
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
DEPT_CAPACITY = {
    "CARDIOLOGY": 22,
    "ORTHOPEDICS": 18,
    "GENERAL": 28,
    "PEDIATRICS": 16,
    "DERMATOLOGY": 14,
    "ENT": 15,
}
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
def _pipeline() -> Pipeline:
    pre = ColumnTransformer(
        [
            ("num", "passthrough", NUMERIC),
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
        ]
    )
    model = RandomForestRegressor(
        n_estimators=120,
        max_depth=12,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1,
    )
    return Pipeline([("pre", pre), ("rf", model)])
def train_crowd_model(df: pd.DataFrame) -> Pipeline:
    X = df[NUMERIC + CATEGORICAL]
    y = df["crowd_count"]
    pipe = _pipeline()
    pipe.fit(X, y)
    return pipe
def classify_congestion(predicted_crowd: float, department: str, capacity: int | None = None) -> str:
    cap = capacity or DEPT_CAPACITY.get(str(department).upper(), 20)
    ratio = predicted_crowd / max(cap, 1)
    if ratio < 0.45:
        return "LOW"
    if ratio < 0.8:
        return "MODERATE"
    return "HIGH"
def predict_crowd(model: Pipeline, features: dict) -> dict:
    row = {k: features.get(k, 0) for k in NUMERIC}
    row["department"] = features.get("department", "GENERAL")
    X = pd.DataFrame([row])
    pred = float(model.predict(X)[0])
    pred = max(pred, 0)
    congestion = classify_congestion(pred, row["department"], features.get("capacity"))
    return {"predicted_crowd": round(pred, 1), "congestion": congestion}
def save_model(model: Pipeline, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, path)
def load_model(path: Path) -> Pipeline:
    return joblib.load(path)
