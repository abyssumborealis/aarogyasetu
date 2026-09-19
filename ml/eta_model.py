"""ETA Model Training and Inference Pipeline aligned with backend contracts."""
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
CATEGORICAL = ["department"]

DEPT_NAME_MAP = {
    "GEN": "General Medicine", "1": "General Medicine", 1: "General Medicine",
    "CAR": "Cardiology", "2": "Cardiology", 2: "Cardiology",
    "ORT": "Orthopaedics", "3": "Orthopaedics", 3: "Orthopaedics",
    "PED": "Paediatrics", "4": "Paediatrics", 4: "Paediatrics",
    "DER": "Dermatology", "5": "Dermatology", 5: "Dermatology",
    "ORTHOPEDICS": "Orthopaedics", "PEDIATRICS": "Paediatrics",
}

def normalize_dept(dept: any) -> str:
    s = str(dept).strip()
    return DEPT_NAME_MAP.get(s, DEPT_NAME_MAP.get(s.upper(), s))

def _pipeline() -> Pipeline:
    pre = ColumnTransformer(
        [
            ("num", "passthrough", NUMERIC),
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL),
        ]
    )
    model = RandomForestRegressor(
        n_estimators=100,
        max_depth=12,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1,
    )
    return Pipeline([("pre", pre), ("rf", model)])

def train_eta_model(df: pd.DataFrame) -> Pipeline:
    df = df.copy()
    df["department"] = df["department"].apply(normalize_dept)
    X = df[NUMERIC + CATEGORICAL]
    y = df["waiting_time_minutes"]
    pipe = _pipeline()
    pipe.fit(X, y)
    return pipe

def predict_eta(model: Pipeline, features: dict) -> dict:
    """Predicts wait time for an arrived physical token."""
    dept = normalize_dept(features.get("department") or features.get("department_code") or features.get("department_id") or "General Medicine")
    
    docs = max(1, int(features.get("doctors_available", 1)))
    avg_srv = max(1.0, float(features.get("average_service_time", 10.0)))
    people_ahead = max(0, int(features.get("people_ahead", 0)))
    q_len = max(people_ahead, int(features.get("queue_length", people_ahead)))
    
    # Priority handling: if raw priority integer is passed (0=Emergency, 1=Priority, 2=Normal)
    if "priority" in features and "emergency_patients" not in features:
        emergencies = 1 if features["priority"] == 0 else 0
    else:
        emergencies = int(features.get("emergency_patients", 0))

    # Auto-derive rate features if caller did not supply them
    srv_rate = float(features.get("service_rate", docs * (60.0 / avg_srv)))
    arr_rate = float(features.get("arrival_rate", float(q_len)))

    row = {
        "queue_length": q_len,
        "people_ahead": people_ahead,
        "doctors_available": docs,
        "patients_being_served": min(docs, q_len),
        "average_service_time": avg_srv,
        "arrival_rate": arr_rate,
        "service_rate": srv_rate,
        "emergency_patients": emergencies,
        "hour": int(features.get("hour", datetime.now().hour if "datetime" in globals() else 10)),
        "department": dept,
    }

    X = pd.DataFrame([row])
    
    try:
        rf = model.named_steps["rf"]
        X_trans = model.named_steps["pre"].transform(X)
        preds = [tree.predict(X_trans)[0] for tree in rf.estimators_]
        pred_val = float(np.mean(preds))
        std_val = float(np.std(preds))
        confidence = round(max(0.5, min(0.98, 1.0 - (std_val / max(pred_val, 1.0)))), 2)
    except Exception:
        pred_val = float(model.predict(X)[0])
        confidence = 0.85

    wait_minutes = max(0, int(round(pred_val)))
    return {
        "estimated_wait_minutes": wait_minutes,
        "confidence": confidence,
        "model_version": "rf-eta-v1.0"
    }

def save_model(model: Pipeline, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, path)

def load_model(path: Path) -> Pipeline:
    return joblib.load(path)
