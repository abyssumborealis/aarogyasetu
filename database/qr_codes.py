"""
QR payload generation / verification for `qr_stations` (stateless, nothing written per rotation).

Static station   (rotation_seconds is NULL):  payload = "<public_id>"
Rotating station (rotation_seconds = N):      payload = "<public_id>.<otp>"
    otp = HMAC-SHA256(secret, floor(unix_time / N)) reduced to 8 digits

Staff dashboard : re-render current_payload(station) as a QR every few seconds.
Patient scan    : parse_payload() -> load station by public_id -> verify_payload().
The previous window is also accepted so a scan started just before a rotation still works.
This only proves the code is fresh; the caller must still check the token belongs to the
same hospital/department, is a virtual token, and is still active.
"""
import hashlib
import hmac
import time
from typing import Optional, Tuple

from app.models import QRStation


def _otp(secret: str, window: int, digits: int = 8) -> str:
    mac = hmac.new(secret.encode(), str(window).encode(), hashlib.sha256).hexdigest()
    return str(int(mac[:12], 16) % 10**digits).zfill(digits)


def current_payload(station: QRStation, now: Optional[float] = None) -> str:
    if station.rotation_seconds is None:
        return station.public_id
    window = int((time.time() if now is None else now) // station.rotation_seconds)
    return f"{station.public_id}.{_otp(station.secret, window)}"


def parse_payload(payload: str) -> Tuple[str, str]:
    """Split a scanned payload into (station public_id, otp). otp is '' for static QRs."""
    public_id, _, otp = payload.strip().partition(".")
    return public_id, otp


def verify_payload(payload: str, station: QRStation, now: Optional[float] = None,
                   drift_windows: int = 1) -> bool:
    if not station.is_active:
        return False
    public_id, otp = parse_payload(payload)
    if not hmac.compare_digest(public_id, station.public_id):
        return False
    if station.rotation_seconds is None:
        return otp == ""
    window = int((time.time() if now is None else now) // station.rotation_seconds)
    return any(
        hmac.compare_digest(otp, _otp(station.secret, window - back))
        for back in range(drift_windows + 1)
    )