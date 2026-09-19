"""
Machine Learning package for Hospital Queue & Patient Flow Management System.
Contains ETA wait-time prediction, future crowd prediction, expected-vs-actual correction engine,
and synthetic flow data generation.
"""
from .eta_model import predict_eta, load_model as load_eta_model
from .crowd_model import predict_crowd, load_model as load_crowd_model
from .correction_engine import CorrectionEngine
__all__ = [
    "predict_eta",
    "load_eta_model",
    "predict_crowd",
    "load_crowd_model",
    "CorrectionEngine",
]
