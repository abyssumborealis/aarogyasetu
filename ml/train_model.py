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
       print(f"Generated ETA features:   {len(datasets['eta']):,} rows")
    # ----------------------------------------------------------------------- #
    # Train ETA Model
    # ----------------------------------------------------------------------- #
    print("\n" + "=" * 65)
    print("STEP 2: Training Waiting Time (ETA) Model")
    print("=" * 65)
    eta_df = datasets["eta"]
    train_eta_df, test_eta_df = train_test_split(eta_df, test_size=0.2, random_state=42)
    eta_pipeline = train_eta_model(train_eta_df)
    # Evaluate on test split
    X_test_eta = test_eta_df[ETA_NUMERIC + ETA_CAT]
    y_test_eta = test_eta_df["waiting_time_minutes"]
    preds_eta = eta_pipeline.predict(X_test_eta)
    eta_mae = mean_absolute_error(y_test_eta, preds_eta)
    eta_r2 = r2_score(y_test_eta, preds_eta)
    print(f"ETA Model Test Results:")
    print(f"  * Mean Absolute Error (MAE): {eta_mae:.2f} minutes")
    print(f"  * R2 Score:                  {eta_r2:.4f}")
    eta_model_path = models_dir / "eta_model.joblib"
    save_eta_model(eta_pipeline, eta_model_path)
    print(f"Serialized ETA model saved to: {eta_model_path}")
    # ----------------------------------------------------------------------- #
    # Train Crowd Model
    # ----------------------------------------------------------------------- #
    print("\n" + "=" * 65)
    print("STEP 3: Training Future Crowd Prediction Model")
    print("=" * 65)
    crowd_df = datasets["crowd"]
    train_crowd_df, test_crowd_df = train_test_split(crowd_df, test_size=0.2, random_state=42)
    crowd_pipeline = train_crowd_model(train_crowd_df)
    # Evaluate on test split
    X_test_crowd = test_crowd_df[CROWD_NUMERIC + CROWD_CAT]
    y_test_crowd = test_crowd_df["crowd_count"]
    preds_crowd = crowd_pipeline.predict(X_test_crowd)
    crowd_mae = mean_absolute_error(y_test_crowd, preds_crowd)
    crowd_r2 = r2_score(y_test_crowd, preds_crowd)
    print(f"Crowd Model Test Results:")
    print(f"  * Mean Absolute Error (MAE): {crowd_mae:.2f} patients")
    print(f"  * R2 Score:                  {crowd_r2:.4f}")
    crowd_model_path = models_dir / "crowd_model.joblib"
    save_crowd_model(crowd_pipeline, crowd_model_path)
    print(f"Serialized Crowd model saved to: {crowd_model_path}")
    # ----------------------------------------------------------------------- #
    # Inference Verification
    # ----------------------------------------------------------------------- #
    print("\n" + "=" * 65)
    print("STEP 4: Verifying Live Inference via Production APIs")
    print("=" * 65)
    loaded_eta = load_eta_model(eta_model_path)
    test_eta_input = {
        "department": "Cardiology",
        "department_code": "CAR",
        "people_ahead": 6,
        "doctors_available": 2,
        "average_service_time": 15,
        "queue_length": 7,
    }
    eta_result = predict_eta(loaded_eta, test_eta_input)
    print(f"Inference Test -> ETA Prediction for Cardiology (6 ahead, 2 docs, 15 min avg):")
    print(f"  Result: {eta_result}")
    loaded_crowd = load_crowd_model(crowd_model_path)
    test_crowd_input = {
        "department": "General Medicine",
        "department_code": "GEN",
        "current_queue": 8,
        "expected_arrivals_15min": 4,
        "expected_arrivals_30min": 9,
        "expected_arrivals_60min": 18,
        "doctors_available": 2,
        "average_service_time": 10,
    }
    crowd_result = predict_crowd(loaded_crowd, test_crowd_input, capacity=25)
    print(f"\nInference Test -> Crowd Prediction for General Medicine (Capacity 25):")
    print(f"  Result: {crowd_result}")
    correction = CorrectionEngine()
    corr_result = correction.adjust_predictions(expected_arrivals=20, actual_arrivals=14, base_capacity=20)
    print(f"\nInference Test -> Correction Engine (20 expected vs 14 actual):")
    print(f"  Result: {corr_result}")
    print("\n" + "=" * 65)
    print("[SUCCESS] All ML components trained, verified, and ready for backend integration!")
    print("=" * 65)
if __name__ == "__main__":
    main()



    
