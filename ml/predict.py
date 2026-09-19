from pathlib import Path
from src.correction_engine import adjust_demand
from src.crowd_model import load_model as load_crowd
from src.crowd_model import predict_crowd
from src.eta_model import load_model as load_eta
from src.eta_model import predict_eta
ROOT = Path(__file__).resolve().parent
CROWD = load_crowd(ROOT / "models" / "crowd_model.pkl")
ETA = load_eta(ROOT / "models" / "eta_model.pkl")
def crowd(features: dict) -> dict:
    return predict_crowd(CROWD, features)
def eta(features: dict) -> dict:
    return predict_eta(ETA, features)
def update(expected: float, actual: float, future: float | None = None) -> dict:
    return adjust_demand(expected, actual, future)
