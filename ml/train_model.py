"""
Automated Training and Evaluation Runner for Hospital Flow ML Models.
Generates synthetic data, trains both ETA and Crowd models, evaluates on test splits,
serializes models to ml/models/, and executes sample inference verification.
"""
from __future__ import annotations
import os
from pathlib import Path
import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from ml.generate_dataset import save_dataset
from ml.eta_model import (
    train_eta_model,
    predict_eta,
    save_model as save_eta_model,
    load_model as load_eta_model,
    NUMERIC_FEATURES as ETA_NUMERIC,
    CATEGORICAL_FEATURES as ETA_CAT,
)
from ml.crowd_model import (
    train_crowd_model,
    predict_crowd,
    save_model as save_crowd_model,
    load_model as load_crowd_model,
    NUMERIC_FEATURES as CROWD_NUMERIC,
    CATEGORICAL_FEATURES as CROWD_CAT,
)
from ml.correction_engine import CorrectionEngine
def main():
    root = Path(__file__).resolve().parent
    data_dir = root / "data"
    models_dir = root / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    print("=" * 65)
    print("STEP 1: Generating Aligned Synthetic Flow Datasets")
    print("=" * 65)
    datasets = save_dataset(data_dir)
    print(f"Generated registrations: {len(datasets['registrations']):,} rows")
    print(f"Generated crowd features: {len(datasets['crowd']):,} rows")
