"""Generate reproducible synthetic hospital flow data aligned with backend models."""
from __future__ import annotations
from datetime import datetime, timedelta
from pathlib import Path
import numpy as np
import pandas as pd

RNG_SEED = 42

# Aligned with database/seed.py DEPARTMENTS and avg_consult_minutes
DEPARTMENTS = [
    {"hospital_id": 1, "department": "General Medicine", "code": "GEN", "capacity": 28, "base_service": 10, "morning_peak": 1.4},
    {"hospital_id": 1, "department": "Cardiology", "code": "CAR", "capacity": 22, "base_service": 15, "morning_peak": 1.6},
    {"hospital_id": 1, "department": "Orthopaedics", "code": "ORT", "capacity": 18, "base_service": 12, "morning_peak": 1.2},
    {"hospital_id": 2, "department": "Paediatrics", "code": "PED", "capacity": 16, "base_service": 10, "morning_peak": 1.3},
    {"hospital_id": 2, "department": "Dermatology", "code": "DER", "capacity": 14, "base_service": 8, "morning_peak": 0.9},
]

def _hour_multiplier(hour: int, morning_peak: float) -> float:
    if 8 <= hour <= 11:
        return morning_peak
    if 14 <= hour <= 16:
        return 1.15
    if hour < 8 or hour > 18:
        return 0.25
    return 0.85

def generate_dataset(n_days: int = 21, start: datetime | None = None) -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(RNG_SEED)
    start = start or datetime(2026, 8, 1, 8, 0, 0)
    registrations, crowd_rows, eta_rows = [], [], []
    reg_id = 1

    for day in range(n_days):
        day0 = start + timedelta(days=day)
        dow = day0.weekday()
        weekend = 0.65 if dow >= 5 else 1.0

        for dept in DEPARTMENTS:
            doctors = 2 if dept["code"] in {"CAR", "GEN"} else 1
            avg_service = float(dept["base_service"]) + float(rng.normal(0, 0.5))
            avg_service = max(4.0, avg_service)

            for hour in range(8, 19):
                mult = _hour_multiplier(hour, dept["morning_peak"]) * weekend
                expected_hour = max(0, int(rng.normal(8 * mult, 2.2)))

                for slot in range(4):
                    slot_start = day0.replace(hour=hour, minute=slot * 15)
                    slot_expected = max(0, int(rng.poisson(max(expected_hour / 4, 0.3))))
                    lead_mean = 6 if 8 <= hour <= 11 else 3
                    for _ in range(slot_expected):
                        lead = max(0.5, rng.normal(lead_mean, 2.0))
                        registrations.append({
                            "registration_id": f"REG-{10000 + reg_id}",
                            "hospital_id": dept["hospital_id"],
                            "department": dept["department"],
                            "department_code": dept["code"],
                            "registration_time": slot_start - timedelta(hours=float(lead)),
                            "expected_arrival_time": slot_start + timedelta(minutes=int(rng.integers(0, 10))),
                            "status": "REGISTERED",
                        })
                        reg_id += 1

                expected_15 = max(0, int(rng.poisson(max(expected_hour / 4, 0.4))))
                expected_30 = expected_15 + max(0, int(rng.poisson(max(expected_hour / 4, 0.4))))
                expected_60 = expected_hour

                show_rate = float(np.clip(rng.normal(0.78, 0.08), 0.5, 0.98))
                actual = int(round(expected_60 * show_rate))
                current_queue = int(np.clip(rng.normal(actual * 0.35 + (18 - doctors * 4), 3), 0, 40))
                
                service_rate = doctors * (60.0 / max(avg_service, 1.0))
                arrival_rate = float(actual)
                emergencies = int(rng.poisson(0.3 if dept["code"] != "CAR" else 0.7))
                people_ahead = max(current_queue - min(doctors, current_queue), 0)
                patients_being_served = min(doctors, current_queue)

                # Queue wait calculation
                wait = (
                    people_ahead * avg_service / max(doctors, 1)
                    + emergencies * 3.5
                    + rng.normal(0, 2.0)
                )
                wait = float(np.clip(wait, 0, 120))

                crowd = (
                    current_queue
                    + expected_30 * show_rate * 0.7
                    - service_rate * 0.25
                    + rng.normal(0, 1.5)
                )
                crowd = float(np.clip(crowd, 0, dept["capacity"] * 2))

                crowd_rows.append({
                    "hospital_id": dept["hospital_id"],
                    "department": dept["department"],
                    "department_code": dept["code"],
                    "date": day0.date().isoformat(),
                    "hour": hour,
                    "day_of_week": dow,
                    "expected_arrivals_15min": expected_15,
                    "expected_arrivals_30min": expected_30,
                    "expected_arrivals_60min": expected_60,
                    "historical_average_arrivals": max(expected_hour * 0.9, 0),
                    "current_queue": current_queue,
                    "doctors_available": doctors,
                    "average_service_time": avg_service,
                    "crowd_count": crowd,
                })

                eta_rows.append({
                    "hospital_id": dept["hospital_id"],
                    "department": dept["department"],
                    "department_code": dept["code"],
                    "hour": hour,
                    "queue_length": current_queue,
                    "people_ahead": people_ahead,
                    "doctors_available": doctors,
                    "patients_being_served": patients_being_served,
                    "average_service_time": avg_service,
                    "arrival_rate": arrival_rate,
                    "service_rate": service_rate,
                    "emergency_patients": emergencies,
                    "waiting_time_minutes": wait,
                })

    return {
        "registrations": pd.DataFrame(registrations),
        "crowd": pd.DataFrame(crowd_rows),
        "eta": pd.DataFrame(eta_rows),
    }

def save_dataset(out_dir: Path) -> dict[str, pd.DataFrame]:
    out_dir.mkdir(parents=True, exist_ok=True)
    data = generate_dataset()
    data["registrations"].to_csv(out_dir / "registrations.csv", index=False)
    data["crowd"].to_csv(out_dir / "crowd_features.csv", index=False)
    data["eta"].to_csv(out_dir / "eta_features.csv", index=False)
    return data

if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    data = save_dataset(root / "data")
    print({k: len(v) for k, v in data.items()})
