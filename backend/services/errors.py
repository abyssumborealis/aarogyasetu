"""
Domain-level errors raised by services/queue_service.py (and friends). These carry no FastAPI
dependency - main.py registers one exception handler that turns any QueueError into the right
HTTP response, so the service layer stays framework-agnostic.
"""


class QueueError(Exception):
    """Base for every domain error. Carries the HTTP status the API layer should return."""
    status_code = 400

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class BadRequest(QueueError):
    status_code = 422


class NotFound(QueueError):
    status_code = 404


class Conflict(QueueError):
    status_code = 409


class Forbidden(QueueError):
    status_code = 403


class InvalidQR(QueueError):
    status_code = 400
