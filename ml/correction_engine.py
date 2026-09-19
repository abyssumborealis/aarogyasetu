"""Rule-based expected vs actual correction. No ML model."""
from __future__ import annotations
def arrival_ratio(expected_arrivals: float, actual_arrivals: float) -> float:
    if expected_arrivals <= 0:
        return 1.3 if actual_arrivals > 0 else 1.0
    ratio = actual_arrivals / expected_arrivals
    return float(min(max(ratio, 0.5), 1.5))
def adjust_demand(expected_arrivals: float, actual_arrivals: float, future_expected: float | None = None) -> dict:
    ratio = arrival_ratio(expected_arrivals, actual_arrivals)
    baseline = future_expected if future_expected is not None else expected_arrivals
    # Blend keeps the original forecast visible while adapting to show-up rate.
    adjusted = baseline * (0.25 + 0.75 * ratio)
    return {
        "expected_arrivals": expected_arrivals,
        "actual_arrivals": actual_arrivals,
        "arrival_ratio": round(ratio, 3),
        "adjusted_demand": round(adjusted, 1),
        "direction": "down" if ratio < 1 else ("up" if ratio > 1 else "steady"),
    }
