"""
Current Waiting Time (ETA) Prediction Model.
Predicts the waiting time in minutes for an arrived physical queue token.
Uses Scikit-learn Pipeline with ColumnTransformer and RandomForestRegressor.
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

NUMERIC_FEATURES = [
    "queue_length",
    "people_ahead",
    "doctors_available",
    "patients_being_served",
    "average_service_time",
    "arrival_rate",
    "service_rate",
    "emergency_patients",
    "hour",
]

CATEGORICAL_FEATURES = ["department"]

DEPT_MAP = {
    "gen": "General Medicine",
    "general": "General Medicine",
    "general medicine": "General Medicine",
    "car": "Cardiology",
    "cardiology": "Cardiology",
    "ort": "Orthopaedics",
    "orthopaedics": "Orthopaedics",
    "orthopedics": "Orthopaedics",
    "ped": "Paediatrics",
    "paediatrics": "Paediatrics",
    "pediatrics": "Paediatrics",
    "der": "Dermatology",
    "dermatology": "Dermatology",
}

def normalize_dept(dept_str: str | None) -> str:
    if not dept_str:
        return "General Medicine"
    return DEPT_MAP.get(dept_str.strip().lower(), "General Medicine")

def build_pipeline() -> Pipeline:
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

def train_eta_model(df: pd.DataFrame) -> Pipeline:
    df = df.copy()
    df["department"] = df["department"].apply(normalize_dept)
    X = df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y = df["waiting_time_minutes"]
    pipe = build_pipeline()
    pipe.fit(X, y)
    return pipe

def predict_eta(model: Pipeline, features: Dict[str, Any]) -> Dict[str, Any]:
    dept_raw = features.get("department") or features.get("department_code") or "General Medicine"
    dept_norm = normalize_dept(str(dept_raw))

    doctors = max(1, int(features.get("doctors_available", 1)))
    avg_srv = max(1.0, float(features.get("average_service_time", 10.0)))
    people_ahead = max(0, int(features.get("people_ahead", 0)))
    queue_len = int(features.get("queue_length", people_ahead + 1))
    
    srv_rate = float(features.get("service_rate", doctors * (60.0 / avg_srv)))
    arr_rate = float(features.get("arrival_rate", srv_rate * 0.85))
    being_served = int(features.get("patients_being_served", min(doctors, queue_len)))
    emergencies = int(features.get("emergency_patients", 0))
    
    hour_val = features.get("hour")
    hour = int(hour_val if hour_val is not None else datetime.now().hour)

    row = {
        "queue_length": queue_len,
        "people_ahead": people_ahead,
        "doctors_available": doctors,
        "patients_being_served": being_served,
        "average_service_time": avg_srv,
        "arrival_rate": arr_rate,
        "service_rate": srv_rate,
        "emergency_patients": emergencies,
        "hour": hour,
        "department": dept_norm,
    }

    df_in = pd.DataFrame([row])
    raw_pred = float(model.predict(df_in)[0])
    wait_minutes = max(0, int(round(raw_pred)))

    confidence = 0.95
    if queue_len > 35 or people_ahead > 30:
        confidence = 0.82
    elif emergencies > 3:
        confidence = 0.88

    return {
        "estimated_wait_minutes": wait_minutes,
        "predicted_wait_minutes": wait_minutes,
        "confidence": confidence,
        "department": dept_norm,
    }

def save_model(model: Pipeline, path: Path | str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, target)

def load_model(path: Path | str) -> Pipeline:
    return joblib.load(path)
