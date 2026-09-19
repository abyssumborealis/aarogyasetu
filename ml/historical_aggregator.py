"""
Historical Crowd Patterns Aggregator.
Aggregates synthetic operational patient flow data by (department, day_of_week, hour)
to compute true historical baselines (average/median crowd, average/median wait times, observations,
and peak/trough demand windows) for patient-facing intelligence.
"""
from __future__ import annotations
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np
import pandas as pd

# Import generator from current directory
try:
    from ml.data_generator import generate_dataset, DEPARTMENTS
    from ml.eta_model import normalize_dept
except ImportError:
    from data_generator import generate_dataset, DEPARTMENTS
    try:
        from eta_model import normalize_dept
    except ImportError:
        def normalize_dept(d):
            return d or "General Medicine"

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

def compute_historical_aggregations(n_days: int = 21) -> Dict[str, Any]:
    """
    Runs the existing data generator and aggregates historical observations
    by department, day of week (0=Mon..6=Sun), and operating hour (8..18).
    """
    raw_data = generate_dataset(n_days=n_days)
    crowd_df = raw_data["crowd"].copy()
    eta_df = raw_data["eta"].copy()

    # Align waiting time from eta_df with crowd_df
    if len(crowd_df) == len(eta_df):
        crowd_df["waiting_time_minutes"] = eta_df["waiting_time_minutes"].values
    else:
        # Fallback to correlated wait calculation
        crowd_df["waiting_time_minutes"] = (
            (crowd_df["current_queue"] * crowd_df["average_service_time"]) / crowd_df["doctors_available"].clip(lower=1)
        ).round(1)

    crowd_df["department"] = crowd_df["department"].apply(normalize_dept)

    # Group by department, day_of_week, hour
    grouped = crowd_df.groupby(["department", "day_of_week", "hour"]).agg(
        avg_crowd=("crowd_count", "mean"),
        med_crowd=("crowd_count", "median"),
        avg_wait=("waiting_time_minutes", "mean"),
        med_wait=("waiting_time_minutes", "median"),
        avg_queue=("current_queue", "mean"),
        observations=("crowd_count", "count"),
    ).reset_index()

    result_store: Dict[str, Dict[str, Any]] = {}

    all_depts = sorted(crowd_df["department"].unique())

    for dept in all_depts:
        result_store[dept] = {}
        for dow in range(7):
            day_slice = grouped[(grouped["department"] == dept) & (grouped["day_of_week"] == dow)].sort_values("hour")

            if day_slice.empty:
                continue

            hourly_records = []
            for _, row in day_slice.iterrows():
                h = int(row["hour"])
                # 12-hour clock label
                if h == 12:
                    t_label = "12 PM"
                elif h > 12:
                    t_label = f"{h - 12} PM"
                else:
                    t_label = f"{h} AM"

                hourly_records.append({
                    "hour": h,
                    "time_label": t_label,
                    "average_crowd": round(float(row["avg_crowd"]), 1),
                    "median_crowd": round(float(row["med_crowd"]), 1),
                    "average_wait_minutes": round(float(row["avg_wait"]), 1),
                    "median_wait_minutes": round(float(row["med_wait"]), 1),
                    "average_queue": round(float(row["avg_queue"]), 1),
                    "observations": int(row["observations"]),
                })

            # Derive busiest period (highest average wait/crowd consecutive window)
            busiest_hour_idx = int(np.argmax([r["average_wait_minutes"] for r in hourly_records]))
            b_hour = hourly_records[busiest_hour_idx]["hour"]
            b_end = min(b_hour + 2, 18)
            b_start_label = hourly_records[busiest_hour_idx]["time_label"]
            b_end_label = "12 PM" if b_end == 12 else (f"{b_end - 12} PM" if b_end > 12 else f"{b_end} AM")
            busiest_period = f"{DAY_NAMES[dow]}, {b_start_label} – {b_end_label}"

            # Derive lowest-demand period (after 12 PM)
            afternoon_records = [r for r in hourly_records if r["hour"] >= 13]
            if afternoon_records:
                quiet_hour_idx = int(np.argmin([r["average_wait_minutes"] for r in afternoon_records]))
                q_hour = afternoon_records[quiet_hour_idx]["hour"]
                q_end = min(q_hour + 2, 18)
                q_start_label = afternoon_records[quiet_hour_idx]["time_label"]
                q_end_label = "12 PM" if q_end == 12 else (f"{q_end - 12} PM" if q_end > 12 else f"{q_end} AM")
                lowest_period = f"{q_start_label} – {q_end_label}"
            else:
                lowest_period = "2 PM – 4 PM"

            # Typical wait range (p25 - p75 approx across the day)
            all_waits = [r["average_wait_minutes"] for r in hourly_records]
            min_wait = int(round(min(all_waits)))
            max_wait = int(round(max(all_waits)))
            typical_wait_range = f"~{min_wait}–{max_wait} min"

            result_store[dept][str(dow)] = {
                "department": dept,
                "day_of_week": dow,
                "day_name": DAY_NAMES[dow],
                "busiest_period": busiest_period,
                "lower_demand_period": lowest_period,
                "typical_wait_range": typical_wait_range,
                "overall_avg_wait": round(float(np.mean(all_waits)), 1),
                "hourly_data": hourly_records,
            }

    return result_store

# In-memory singleton cache
_CACHE: Optional[Dict[str, Any]] = None

def get_historical_crowd_pattern(department: str, day_of_week: int = 0) -> Dict[str, Any]:
    """Public query interface for FastAPI and scripts."""
    global _CACHE
    if _CACHE is None:
        _CACHE = compute_historical_aggregations(n_days=21)

    dept_norm = normalize_dept(department)
    # Default to General Medicine if not found
    dept_data = _CACHE.get(dept_norm) or _CACHE.get("General Medicine", {})
    dow_str = str(int(day_of_week) % 7)

    return dept_data.get(dow_str, {
        "department": dept_norm,
        "day_of_week": day_of_week,
        "day_name": DAY_NAMES[int(day_of_week) % 7],
        "busiest_period": f"{DAY_NAMES[int(day_of_week) % 7]}, 10 AM – 12 PM",
        "lower_demand_period": "2 PM – 4 PM",
        "typical_wait_range": "~30–60 min",
        "hourly_data": [],
    })

def export_historical_data_bundle(out_dir: Path | None = None) -> Path:
    """Exports both JSON bundle and a client-side JS module."""
    if out_dir is None:
        out_dir = Path(__file__).resolve().parent / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    
    data = compute_historical_aggregations(n_days=21)
    
    json_path = out_dir / "historical_patterns.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        
    return json_path

if __name__ == "__main__":
    out = export_historical_data_bundle()
    print(f"Successfully generated historical aggregation bundle to: {out}")
