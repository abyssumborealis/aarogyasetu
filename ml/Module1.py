"""
Preprocessing and feature extraction utilities for Hospital Queue ML models.
Handles time-window aggregations, cyclical features, and tabular transformations.
"""

import numpy as np
import pandas as pd
from typing import Dict, Any, List

DEPARTMENT_ENCODING = {
    "Cardiology": 0,
    "ENT": 1,
    "Orthopedics": 2,
    "Pediatrics": 3,
    "General Medicine": 4,
    "Dermatology": 5
}

HOSPITAL_ENCODING = {
    "H001": 0,  # CityCare Hospital
    "H002": 1,  # MetroHealth Medical Center
    "H003": 2   # St. Jude General Hospital
}

def encode_department(dept_name: str) -> int:
    return DEPARTMENT_ENCODING.get(dept_name, 0)

def encode_hospital(hosp_id: str) -> int:
    return HOSPITAL_ENCODING.get(hosp_id, 0)

def extract_crowd_features(data: Dict[str, Any]) -> np.ndarray:
    """
    Extracts features for Future Crowd Prediction model.
    Features:
    [
        hospital_code,
        dept_code,
        expected_15m,
        expected_30m,
        expected_60m,
        doctors_available,
        average_service_time,
        current_queue,
        service_capacity_60m  # (doctors * 60 / avg_service_time)
    ]
    """
    hosp_code = encode_hospital(str(data.get("hospital_id", "H001")))
    dept_code = encode_department(str(data.get("department", "Cardiology")))
    exp_15 = float(data.get("expected_arrivals_15min", 0))
    exp_30 = float(data.get("expected_arrivals_30min", 0))
    exp_60 = float(data.get("expected_arrivals_60min", 0))
    doctors = max(1, int(data.get("doctors_available", 1)))
    avg_srv = max(1.0, float(data.get("average_service_time", 8.0)))
    cur_queue = float(data.get("current_queue", 0))
    
    hourly_capacity = (doctors * 60.0) / avg_srv
    
    return np.array([[
        hosp_code,
        dept_code,
        exp_15,
        exp_30,
        exp_60,
        doctors,
        avg_srv,
        cur_queue,
        hourly_capacity
    ]])

def extract_eta_features(data: Dict[str, Any]) -> np.ndarray:
    """
    Extracts features for Current Waiting Time (ETA) model.
    Features:
    [
        hosp_code,
        dept_code,
        queue_length,
        people_ahead,
        doctors_available,
        average_service_time,
        patients_being_served,
        emergency_patients,
        effective_queue_load  # people_ahead + 2.5 * emergency_patients
    ]
    """
    hosp_code = encode_hospital(str(data.get("hospital_id", "H001")))
    dept_code = encode_department(str(data.get("department", "Cardiology")))
    queue_len = float(data.get("queue_length", 0))
    people_ahead = float(data.get("people_ahead", 0))
    doctors = max(1, int(data.get("doctors_available", 1)))
    avg_srv = max(1.0, float(data.get("average_service_time", 8.0)))
    being_served = float(data.get("patients_being_served", 0))
    emergencies = float(data.get("emergency_patients", 0))
    
    effective_load = people_ahead + (2.5 * emergencies)
    
    return np.array([[
        hosp_code,
        dept_code,
        queue_len,
        people_ahead,
        doctors,
        avg_srv,
        being_served,
        emergencies,
        effective_load
    ]])

def classify_congestion(crowd_count: float, capacity: float = 20.0) -> str:
    """
    Classifies congestion into LOW, MEDIUM, HIGH based on capacity threshold.
    """
    ratio = crowd_count / max(1.0, capacity)
    if ratio < 0.65:
        return "LOW"
    elif ratio < 1.15:
        return "MEDIUM"
    else:
        return "HIGH"