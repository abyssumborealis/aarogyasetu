"""
FastAPI Microservice for Unified ML Predictions.
Can be run standalone:
    uvicorn ml.api:app --port 8001 --reload
"""
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ml.eta_model import predict_eta as run_predict_eta, load_model as load_eta_model
from ml.crowd_model import predict_crowd as run_predict_crowd, load_model as load_crowd_model
from ml.correction_engine import CorrectionEngine
from ml.historical_aggregator import get_historical_crowd_pattern

app = FastAPI(title="Hospital Queue ML Microservice", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

MODELS_DIR = Path(__file__).resolve().parent / "models"
eta_model = load_eta_model(MODELS_DIR / "eta_model.joblib") if (MODELS_DIR / "eta_model.joblib").exists() else None
crowd_model = load_crowd_model(MODELS_DIR / "crowd_model.joblib") if (MODELS_DIR / "crowd_model.joblib").exists() else None
correction_engine = CorrectionEngine(smoothing_weight=0.7)

class ETAPredictionRequest(BaseModel):
    department: str = Field("Cardiology")
    department_code: Optional[str] = None
    people_ahead: int = 0
    doctors_available: int = 1
    average_service_time: float = 10.0
    queue_length: Optional[int] = None
    emergency_patients: int = 0
    hour: Optional[int] = None

class CrowdPredictionRequest(BaseModel):
    department: str = Field("General Medicine")
    department_code: Optional[str] = None
    expected_arrivals_15min: int = 0
    expected_arrivals_30min: int = 0
    expected_arrivals_60min: int = 0
    current_queue: int = 0
    doctors_available: int = 1
    average_service_time: float = 10.0
    capacity: int = 20

class AdherenceCorrectionRequest(BaseModel):
    expected_arrivals: int
    actual_arrivals: int
    base_capacity: int = 20

@app.get("/health")
def health():
    return {"status": "healthy", "eta_model_loaded": eta_model is not None, "crowd_model_loaded": crowd_model is not None}

@app.post("/predict/eta")
def predict_eta(req: ETAPredictionRequest):
    if eta_model is None:
        docs = max(1, req.doctors_available)
        return {"estimated_wait_minutes": round((req.people_ahead * req.average_service_time) / docs), "source": "fallback"}
    data = req.model_dump()
    if data["queue_length"] is None:
        data["queue_length"] = data["people_ahead"] + 1
    res = run_predict_eta(eta_model, data)
    res["source"] = "random_forest_regressor"
    return res

@app.post("/predict/crowd")
def predict_crowd(req: CrowdPredictionRequest):
    if crowd_model is None:
        raise HTTPException(status_code=503, detail="Crowd model not loaded.")
    data = req.model_dump()
    cap = data.pop("capacity", 20)
    return run_predict_crowd(crowd_model, data, capacity=cap)

@app.post("/correct/adherence")
def correct_adherence(req: AdherenceCorrectionRequest):
    return correction_engine.adjust_predictions(req.expected_arrivals, req.actual_arrivals, req.base_capacity)

@app.get("/historical/crowd-pattern")
def get_crowd_pattern(department: str = "General Medicine", day_of_week: int = 0):
    return get_historical_crowd_pattern(department, day_of_week)
