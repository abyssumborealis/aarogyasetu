from __future__ import annotations
import pandas as pd
def create_time_features(df: pd.DataFrame, time_col: str = "expected_arrival_time") -> pd.DataFrame:
    out = df.copy()
    ts = pd.to_datetime(out[time_col])
    out["date"] = ts.dt.date.astype(str)
    out["hour"] = ts.dt.hour
    out["day_of_week"] = ts.dt.dayofweek
    out["minute"] = ts.dt.minute
    out["slot_15"] = (ts.dt.minute // 15) * 15
    return out
def calculate_lead_time(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    expected = pd.to_datetime(out["expected_arrival_time"])
    registered = pd.to_datetime(out["registration_time"])
    out["registration_lead_hours"] = (expected - registered).dt.total_seconds() / 3600.0
    return out
def aggregate_expected_arrivals(df: pd.DataFrame) -> pd.DataFrame:
    timed = create_time_features(calculate_lead_time(df))
    timed["ts"] = pd.to_datetime(timed["expected_arrival_time"])
    grouped = []
    keys = ["hospital_id", "department", "date", "hour"]
    for key, part in timed.groupby(keys):
        hospital_id, department, date, hour = key
        hour_start = pd.Timestamp(f"{date} {int(hour):02d}:00:00")
        c15 = ((part["ts"] >= hour_start) & (part["ts"] < hour_start + pd.Timedelta(minutes=15))).sum()
        c30 = ((part["ts"] >= hour_start) & (part["ts"] < hour_start + pd.Timedelta(minutes=30))).sum()
        c60 = len(part)
        grouped.append(
            {
                "hospital_id": hospital_id,
                "department": department,
                "date": date,
                "hour": int(hour),
                "day_of_week": int(part["day_of_week"].iloc[0]),
                "expected_arrivals_15min": int(c15),
                "expected_arrivals_30min": int(c30),
                "expected_arrivals_60min": int(c60),
                "average_registration_lead_time": float(part["registration_lead_hours"].mean()),
            }
        )
    agg = pd.DataFrame(grouped)
    hist = (
        agg.groupby(["hospital_id", "department", "hour"])["expected_arrivals_60min"]
        .mean()
        .rename("historical_average_arrivals")
        .reset_index()
    )
    return agg.merge(hist, on=["hospital_id", "department", "hour"], how="left")
def create_ml_feature_table(registrations: pd.DataFrame) -> pd.DataFrame:
    """Module 1 output: time-window expected-arrival features. No model training."""
    return aggregate_expected_arrivals(registrations)
