from __future__ import annotations
from pathlib import Path
import joblib
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
def train_eta_model(df: pd.DataFrame) -> Pipeline:
    X = df[NUMERIC + CATEGORICAL]
    y = df["waiting_time_minutes"]
    pipe = _pipeline()
    pipe.fit(X, y)
    return pipe
def predict_eta(model: Pipeline, features: dict) -> dict:
    row = {k: features.get(k, 0) for k in NUMERIC}
    row["department"] = features.get("department", "GENERAL")
    X = pd.DataFrame([row])
    pred = max(float(model.predict(X)[0]), 0)
    return {"estimated_wait_minutes": round(pred, 1)}
def save_model(model: Pipeline, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, path)
def load_model(path: Path) -> Pipeline:
    return joblib.load(path)
