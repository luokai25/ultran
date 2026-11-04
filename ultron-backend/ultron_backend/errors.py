"""Typed error hierarchy mapped onto HTTP status codes."""

from __future__ import annotations

from typing import Any


class UltronError(Exception):
    """Base class for every domain error raised by the backend."""

    status_code = 500
    code = "ultron_error"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_payload(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"{type(self).__name__}({self.message!r})"


class ValidationFailed(UltronError):
    status_code = 422
    code = "validation_failed"


class NotFound(UltronError):
    status_code = 404
    code = "not_found"


class Conflict(UltronError):
    status_code = 409
    code = "conflict"


class Unauthorized(UltronError):
    status_code = 401
    code = "unauthorized"


class Forbidden(UltronError):
    status_code = 403
    code = "forbidden"


class QuotaExceeded(UltronError):
    status_code = 402
    code = "quota_exceeded"


class DeployFailed(UltronError):
    status_code = 500
    code = "deploy_failed"


class DependencyUnavailable(UltronError):
    status_code = 503
    code = "dependency_unavailable"
