"""Argument validation against a tool's declared ``inputSchema``.

Two layers, cheapest first:

1. **Soundness** - the schema itself must be a usable object schema. A server
   that ships ``{"type": "object"}`` is fine; one that ships ``"string"`` or a
   ``$ref`` to a document we do not have is not, and we refuse it at discovery
   time rather than at call time.
2. **Validation** - ``jsonschema`` when it is installed, otherwise a small
   in-house checker that covers the subset MCP servers actually emit
   (``object``/``array``/``string``/``number``/``integer``/``boolean``/``null``,
   ``required``, ``properties``, ``additionalProperties``, ``enum``, bounds).

Errors are raised as :class:`SchemaInvalid` with a ``violations`` list so the
model gets something it can repair against instead of a stack trace.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .errors import SchemaInvalid

try:  # pragma: no cover - exercised by the fallback path when absent
    import jsonschema as _jsonschema
    from jsonschema import Draft202012Validator as _Validator
except Exception:  # noqa: BLE001 - absence is a supported configuration
    _jsonschema = None
    _Validator = None

_JSON_TYPES = {
    "object",
    "array",
    "string",
    "number",
    "integer",
    "boolean",
    "null",
}


@dataclass(frozen=True)
class SchemaProblem:
    path: str
    message: str

    def as_text(self) -> str:
        return f"{self.path}: {self.message}" if self.path else self.message

    def as_dict(self) -> dict[str, str]:
        return {"path": self.path, "message": self.message}


def empty_schema() -> dict[str, Any]:
    return {"type": "object", "properties": {}, "additionalProperties": True}


def is_valid_tool_schema(schema: object) -> tuple[bool, str]:
    """Check that a schema is something we can actually enforce."""
    if schema is None:
        return True, ""
    if not isinstance(schema, Mapping):
        return False, "inputSchema must be a JSON object"
    declared_type = schema.get("type")
    if declared_type is not None and declared_type != "object":
        return False, f"inputSchema.type must be 'object', got {declared_type!r}"
    for key in ("oneOf", "anyOf", "allOf", "not"):
        # These are legal JSON Schema but they make the "is this argument
        # required?" question undecidable for the planner. Refuse them.
        if key in schema:
            return False, f"inputSchema.{key} is not supported"
    if "$ref" in schema:
        return False, "inputSchema.$ref is not supported (no external refs)"
    properties = schema.get("properties")
    if properties is not None and not isinstance(properties, Mapping):
        return False, "inputSchema.properties must be a JSON object"
    required = schema.get("required")
    if required is not None and not isinstance(required, (list, tuple)):
        return False, "inputSchema.required must be an array"
    return True, ""


def _normalise_schema(schema: Mapping[str, Any] | None) -> dict[str, Any]:
    if not schema:
        return empty_schema()
    out = dict(schema)
    out.setdefault("type", "object")
    out.setdefault("properties", {})
    out.setdefault("additionalProperties", True)
    return out


def _path(prefix: str, key: str) -> str:
    return f"{prefix}.{key}" if prefix else key


def _check_type(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, Mapping)
    if expected == "array":
        return isinstance(value, (list, tuple))
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def _fallback_validate(
    value: Any,
    schema: Mapping[str, Any],
    path: str,
    problems: list[SchemaProblem],
) -> None:
    expected = schema.get("type")
    if isinstance(expected, list):
        types = [t for t in expected if isinstance(t, str)]
        if types and not any(_check_type(value, t) for t in types):
            problems.append(SchemaProblem(path, f"expected one of {types}, got {type(value).__name__}"))
            return
    elif isinstance(expected, str) and expected in _JSON_TYPES:
        if not _check_type(value, expected):
            problems.append(SchemaProblem(path, f"expected {expected}, got {type(value).__name__}"))
            return

    enum = schema.get("enum")
    if isinstance(enum, (list, tuple)) and value not in enum:
        problems.append(SchemaProblem(path, f"must be one of {list(enum)!r}"))

    if isinstance(value, str):
        minimum = schema.get("minLength")
        maximum = schema.get("maxLength")
        if isinstance(minimum, int) and len(value) < minimum:
            problems.append(SchemaProblem(path, f"must be at least {minimum} characters"))
        if isinstance(maximum, int) and len(value) > maximum:
            problems.append(SchemaProblem(path, f"must be at most {maximum} characters"))
        pattern = schema.get("pattern")
        if isinstance(pattern, str):
            import re

            try:
                if not re.search(pattern, value):
                    problems.append(SchemaProblem(path, f"must match pattern {pattern!r}"))
            except re.error:
                pass

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        exclusive_min = schema.get("exclusiveMinimum")
        exclusive_max = schema.get("exclusiveMaximum")
        if isinstance(minimum, (int, float)) and value < minimum:
            problems.append(SchemaProblem(path, f"must be >= {minimum}"))
        if isinstance(maximum, (int, float)) and value > maximum:
            problems.append(SchemaProblem(path, f"must be <= {maximum}"))
        if isinstance(exclusive_min, (int, float)) and value <= exclusive_min:
            problems.append(SchemaProblem(path, f"must be > {exclusive_min}"))
        if isinstance(exclusive_max, (int, float)) and value >= exclusive_max:
            problems.append(SchemaProblem(path, f"must be < {exclusive_max}"))

    if isinstance(value, Mapping):
        properties = schema.get("properties") or {}
        required = schema.get("required") or ()
        for key in required:
            if key not in value:
                problems.append(SchemaProblem(_path(path, key), "required property is missing"))
        additional = schema.get("additionalProperties", True)
        for key, item in value.items():
            if key in properties:
                sub = properties[key]
                if isinstance(sub, Mapping):
                    _fallback_validate(item, sub, _path(path, key), problems)
            elif additional is False:
                problems.append(SchemaProblem(_path(path, key), "property is not allowed"))
            elif isinstance(additional, Mapping):
                _fallback_validate(item, additional, _path(path, key), problems)

    if isinstance(value, (list, tuple)):
        items = schema.get("items")
        if isinstance(items, Mapping):
            for index, item in enumerate(value):
                _fallback_validate(item, items, f"{path}[{index}]", problems)
        minimum = schema.get("minItems")
        maximum = schema.get("maxItems")
        if isinstance(minimum, int) and len(value) < minimum:
            problems.append(SchemaProblem(path, f"must contain at least {minimum} items"))
        if isinstance(maximum, int) and len(value) > maximum:
            problems.append(SchemaProblem(path, f"must contain at most {maximum} items"))


def validate_arguments(
    tool_name: str,
    schema: Mapping[str, Any] | None,
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Validate ``arguments`` against ``schema``; return the cleaned dict.

    Raises :class:`SchemaInvalid` listing every violation at once so the model
    can fix them in one repair round.
    """
    if arguments is None:
        arguments = {}
    if not isinstance(arguments, Mapping):
        raise SchemaInvalid(
            "tool arguments must be a JSON object",
            details={"tool": tool_name, "got": type(arguments).__name__},
        )

    ok, reason = is_valid_tool_schema(schema)
    if not ok:
        raise SchemaInvalid(
            "tool declares an unusable inputSchema",
            details={"tool": tool_name, "reason": reason},
        )

    cleaned = dict(arguments)
    normalised = _normalise_schema(schema)

    problems: list[SchemaProblem] = []
    if _Validator is not None:
        validator = _Validator(normalised)
        for error in sorted(validator.iter_errors(cleaned), key=lambda e: list(e.absolute_path)):
            path = ".".join(str(p) for p in error.absolute_path)
            problems.append(SchemaProblem(path, error.message))
    else:  # pragma: no cover - only when jsonschema is not installed
        _fallback_validate(cleaned, normalised, "", problems)

    if problems:
        raise SchemaInvalid(
            f"arguments for {tool_name!r} do not match its schema",
            details={
                "tool": tool_name,
                "violations": [p.as_dict() for p in problems],
                "summary": "; ".join(p.as_text() for p in problems[:5]),
            },
        )
    return cleaned


def required_keys(schema: Mapping[str, Any] | None) -> list[str]:
    if not schema:
        return []
    required = schema.get("required") or ()
    return [str(k) for k in required if isinstance(k, str)]


def coerce_resource_payload(value: Any) -> Any:
    """Best-effort parse of a text MCP content block into JSON."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or text[0] not in "[{":
        return value
    import json

    try:
        return json.loads(text)
    except ValueError:
        return value


__all__ = [
    "SchemaProblem",
    "coerce_resource_payload",
    "empty_schema",
    "is_valid_tool_schema",
    "required_keys",
    "validate_arguments",
]
