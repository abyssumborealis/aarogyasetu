"""Expected vs Actual Correction Engine (Module 4)."""
from typing import Dict, Any

class CorrectionEngine:
    def __init__(self, smoothing_weight: float = 0.7):
        self.smoothing_weight = smoothing_weight

    def adjust(self, expected_arrivals: int, actual_arrivals: int, base_capacity: int = 20) -> Dict[str, Any]:
        if expected_arrivals <= 0:
            ratio = 1.0 if actual_arrivals == 0 else 1.2
        else:
            ratio = round(float(actual_arrivals) / float(expected_arrivals), 3)

        adjusted_factor = (ratio * self.smoothing_weight) + (1.0 * (1.0 - self.smoothing_weight))
        adjusted_expected = max(0, int(round(expected_arrivals * adjusted_factor)))

        load_ratio = adjusted_expected / max(1.0, float(base_capacity))
        if load_ratio < 0.6:
            congestion = "low"
        elif load_ratio < 1.1:
            congestion = "medium"
        elif load_ratio < 1.5:
            congestion = "high"
        else:
            congestion = "critical"

        return {
            "arrival_ratio": ratio,
            "adherence_percentage": round(ratio * 100, 1),
            "adjusted_expected_arrivals": adjusted_expected,
            "congestion": congestion,
            "correction_factor": round(adjusted_factor, 3),
            "explanation": f"Arrival adherence is {round(ratio * 100, 1)}%. Expected demand scaled from {expected_arrivals} to {adjusted_expected}."
        }
