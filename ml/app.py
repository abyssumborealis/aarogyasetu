from  pathlib import Path
from fastapi import FastAPI
from pydantic import BaseModel, Field
from src.correction_engine import adjust_demand
from src.crowd_model import load_model as load_crowd
from src.crowd_model import predict_crowd
from src.eta_model import load_model as load_eta
from src.eta_model import predict_eta
ROOT = Path(__file__).resolve().parent
CROWD_PATH = ROOT / "models" / "crowd_model.pkl"
ETA_PATH = ROOT / "models" / "eta_model.pkl"
app = FastAPI(title="Hospital Queue ML API", version="1.0.0")
crowd_model = load_crowd(CROWD_PATH) if CROWD_PATH.exists() else None
eta_model = load_eta(ETA_PATH) if ETA_PATH.exists() else None
class CrowdIn(BaseModel):
    hospital_id: str = "H001"
    department: str
    expected_arrivals_15min: float
    expected_arrivals_30min: float
    expected_arrivals_60min: float
    doctors_available: float
    average_service_time: float
    current_queue: float
    historical_average_arrivals: float | None = None
    hour: int = 10
    day_of_week: int = 0
    capacity: int | None = None
class EtaIn(BaseModel):
    queue_length: float
    people_ahead: float
    doctors_available: float
    patients_being_served: float
    average_service_time: float
    arrival_rate: float = 4
    service_rate: float = 6
    emergency_patients: float = 0
    hour: int = 10
    department: str = "CARDIOLOGY"
class UpdateIn(BaseModel):
    expected_arrivals: float
    actual_arrivals: float
    future_expected: float | None = Field(default=None)
@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "ml",
        "crowd_model": crowd_model is not None,
        "eta_model": eta_model is not None,
    }
@app.post("/predict/crowd")
def crowd(payload: CrowdIn):
    if crowd_model is None:
        approx = payload.current_queue + payload.expected_arrivals_30min * 0.7
        level = "HIGH" if approx > 20 else ("MODERATE" if approx > 10 else "LOW")
        return {"predicted_crowd": round(approx, 1), "congestion": level, "fallback": True}
    features = payload.model_dump()
    if features["historical_average_arrivals"] is None:
        features["historical_average_arrivals"] = features["expected_arrivals_60min"]
    return predict_crowd(crowd_model, features)
@app.post("/predict/eta")
def eta(payload: EtaIn):
    if eta_model is None:
        wait = payload.people_ahead * payload.average_service_time / max(payload.doctors_available, 1)
        return {"estimated_wait_minutes": round(wait, 1), "fallback": True}
    return predict_eta(eta_model, payload.model_dump())
@app.post("/predict/update")
def update(payload: UpdateIn):
    return adjust_demand(payload.expected_arrivals, payload.actual_arrivals, payload.future_expected)
