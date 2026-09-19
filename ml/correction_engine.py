"""
Expected vs Actual Correction Engine (Module 4).
Bridges pre-arrival registration intent (virtual queue) with physical QR scan reality (ground truth).
Dynamically calculates arrival adherence ratios and modulates future crowd forecasts.
"""
from __future__ import annotations
from typing import Any, Dict, List

class CorrectionEngine:
    def __init__(self, smoothing_weight: float = 0.7):
        self.smoothing_weight = smoothing_weight
        self.adherence_history: List[float] = []

    def compute_adherence(self, expected_arrivals: int, actual_arrivals: int) -> float:
        if expected_arrivals <= 0:
            return 1.0 if actual_arrivals == 0 else 1.2
        return round(float(actual_arrivals) / float(expected_arrivals), 3)

    def get_smoothed_adherence(self, current_adherence: float) -> float:
        self.adherence_history.append(current_adherence)
        if len(self.adherence_history) > 20:
            self.adherence_history.pop(0)
        smoothed = (current_adherence * self.smoothing_weight) + (1.0 * (1.0 - self.smoothing_weight))
        return round(smoothed, 3)

    def adjust_predictions(
        self, expected_arrivals: int, actual_arrivals: int, base_capacity: int = 20
    ) -> Dict[str, Any]:
        raw_ratio = self.compute_adherence(expected_arrivals, actual_arrivals)
        multiplier = self.get_smoothed_adherence(raw_ratio)
        adjusted_expected = max(0, int(round(expected_arrivals * multiplier)))

        load_ratio = adjusted_expected / max(1.0, float(base_capacity))
        if load_ratio < 0.65:
            congestion = "low"
        elif load_ratio < 1.05:
            congestion = "medium"
        elif load_ratio < 1.50:
            congestion = "high"
        else:
            congestion = "critical"

        adherence_pct = round(raw_ratio * 100, 1)
        explanation = (
            f"Adherence is {adherence_pct}%. Adjusted future expected demand from "
            f"{expected_arrivals} to {adjusted_expected}."
        )

        return {
            "arrival_ratio": raw_ratio,
            "adherence_percentage": adherence_pct,
            "correction_multiplier": multiplier,
            "raw_expected_arrivals": expected_arrivals,
            "adjusted_expected_arrivals": adjusted_expected,
            "congestion": congestion,
            "explanation": explanation,
        }

    def calibrate_features(
        self, features: Dict[str, Any], recent_expected: int, recent_actual: int
    ) -> Dict[str, Any]:
        ratio = self.compute_adherence(recent_expected, recent_actual)
        multiplier = self.get_smoothed_adherence(ratio)
        calibrated = dict(features)
        for key in ["expected_arrivals_15min", "expected_arrivals_30min", "expected_arrivals_60min"]:
            if key in calibrated:
                calibrated[key] = max(0, int(round(float(calibrated[key]) * multiplier)))
        calibrated["adherence_ratio"] = ratio
        calibrated["correction_multiplier"] = multiplier
        return calibrated
