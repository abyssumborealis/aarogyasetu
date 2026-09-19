"""
Machine Learning package for Hospital Queue & Patient Flow Management System.
Contains ETA wait-time prediction, future crowd prediction, expected-vs-actual correction engine,
and synthetic flow data generation.
"""
try:
    from .eta_model import predict_eta, load_model as load_eta_model
except ImportError:
    predict_eta = None
    load_eta_model = None

try:
    from .crowd_model import predict_crowd, load_model as load_crowd_model
except ImportError:
    predict_crowd = None
    load_crowd_model = None

from .correction_engine import CorrectionEngine

__all__ = [
    "predict_eta",
    "load_eta_model",
    "predict_crowd",
    "load_crowd_model",
    "CorrectionEngine",
]
