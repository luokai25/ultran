"""Tool specs, annotations, schema validation and result normalisation."""

from __future__ import annotations

import pytest

from ultran_backend.mcp import (
    CallResult,
    ToolAnnotations,
    ToolSpec,
    is_valid_tool_schema,
    manifest_hash,
    normalise_result,
    validate_arguments,
)
from ultran_backend.mcp.errors import SchemaInvalid


def wire_tool(name: str, **kw) -> dict:
    base = {
        "name": name,
        "description": f"{name} tool",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": True},
    }
    base.update(kw)
    return base


# ---------------------------------------------------------------- annotations


def test_read_only_hint_yields_read_capability():
    a = ToolAnnotations.from_wire("anything", annotations={"readOnlyHint": True})
    assert a.capabilities == {"read"}
    assert a.read_only
    assert not a.mutating
    assert a.declared


def test_destructive_hint_yields_write_and_delete_and_needs_approval():
    a = ToolAnnotations.from_wire("anything", annotations={"destructiveHint": True})
    assert {"write", "delete"} <= a.capabilities
    assert a.destructive
    assert a.requires_approval


def test_open_world_hint_adds_network():
    a = ToolAnnotations.from_wire("fetch", annotations={"openWorldHint": True})
    assert "network" in a.capabilities


def test_explicit_ultran_capabilities_win():
    a = ToolAnnotations.from_wire("x", meta={"ultran/capabilities": ["read", "network"]})
    assert a.capabilities == {"read", "network"}
    assert a.declared


def test_unknown_capability_is_rejected():
    with pytest.raises(ValueError, match="unknown capability"):
        ToolAnnotations.from_wire("x", meta={"ultran/capabilities": ["telepathy"]})


@pytest.mark.parametrize(
    "name,expected",
    [
        ("read_file", {"read"}),
        ("list_issues", {"read"}),
        ("search", {"read"}),
        ("write_file", {"write"}),
        ("create_issue", {"write"}),
        ("delete_repository", {"write", "delete"}),
        ("run_command", {"write", "execute"}),
    ],
)
def test_capabilities_are_inferred_from_the_tool_name(name, expected):
    a = ToolAnnotations.from_wire(name)
    assert a.capabilities == expected


def test_unknown_verb_defaults_to_write_not_read():
    """Under-declaring a capability is how a read grant becomes a delete."""
    a = ToolAnnotations.from_wire("frobnicate")
    assert a.capabilities == {"write"}
    assert not a.read_only


def test_camel_case_and_dotted_names_are_tokenised():
    assert ToolAnnotations.from_wire("readFile").capabilities == {"read"}
    assert ToolAnnotations.from_wire("fs.read-file").capabilities == {"read"}


def test_sensitive_verbs_require_approval():
    for name in ("send_email", "post_message", "publish_media", "commit", "deploy_app"):
        assert ToolAnnotations.from_wire(name).requires_approval, name


def test_plain_reads_do_not_require_approval():
    for name in ("read_file", "list_repos", "search", "get_file"):
        assert not ToolAnnotations.from_wire(name).requires_approval, name


def test_annotations_round_trip_to_dict():
    a = ToolAnnotations.from_wire("read_file", annotations={"readOnlyHint": True})
    payload = a.to_dict()
    assert payload["capabilities"] == ["read"]
    assert payload["read_only"] is True
    assert payload["declared"] is True


# ---------------------------------------------------------------- tool specs


def test_tool_spec_is_namespaced():
    spec = ToolSpec.from_wire("fs", wire_tool("read_file"))
    assert spec.id == "fs.read_file"
    assert spec.server_id == "fs"
    assert spec.name == "read_file"


def test_tool_spec_requires_a_name():
    with pytest.raises(ValueError, match="no name"):
        ToolSpec.from_wire("fs", {"description": "x"})


def test_tool_spec_rejects_a_non_object_schema():
    with pytest.raises(ValueError, match="unusable inputSchema"):
        ToolSpec.from_wire("fs", wire_tool("bad", inputSchema={"type": "string"}))


def test_tool_spec_rejects_oneof_schema():
    with pytest.raises(ValueError, match="unusable inputSchema"):
        ToolSpec.from_wire("fs", wire_tool("bad", inputSchema={"oneOf": [{"type": "object"}]}))


def test_tool_spec_fingerprint_is_stable_and_content_addressed():
    a = ToolSpec.from_wire("fs", wire_tool("read_file"))
    b = ToolSpec.from_wire("fs", wire_tool("read_file"))
    c = ToolSpec.from_wire("fs", wire_tool("read_file", description="different"))
    assert a.fingerprint() == b.fingerprint()
    assert a.fingerprint() != c.fingerprint()


def test_tool_spec_exposes_required_keys():
    spec = ToolSpec.from_wire(
        "fs",
        wire_tool(
            "read_file",
            inputSchema={
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        ),
    )
    assert spec.required == ["path"]


def test_tool_spec_renders_as_an_openai_function():
    spec = ToolSpec.from_wire("fs", wire_tool("read_file"))
    rendered = spec.as_openai_tool()
    assert rendered["type"] == "function"
    assert rendered["function"]["name"] == "fs__read_file"
    assert rendered["function"]["parameters"]["type"] == "object"


def test_manifest_hash_changes_when_a_tool_changes():
    a = [ToolSpec.from_wire("fs", wire_tool("read_file"))]
    b = [ToolSpec.from_wire("fs", wire_tool("read_file", description="now different"))]
    assert manifest_hash(a) != manifest_hash(b)


def test_manifest_hash_ignores_tool_order():
    a = [ToolSpec.from_wire("fs", wire_tool("a")), ToolSpec.from_wire("fs", wire_tool("b"))]
    b = list(reversed(a))
    assert manifest_hash(a) == manifest_hash(b)


# ---------------------------------------------------------------- schema


def test_schema_accepts_a_valid_payload():
    schema = {
        "type": "object",
        "properties": {"path": {"type": "string"}},
        "required": ["path"],
    }
    assert validate_arguments("read_file", schema, {"path": "/tmp/x"}) == {"path": "/tmp/x"}


def test_schema_rejects_a_missing_required_key():
    schema = {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}
    with pytest.raises(SchemaInvalid) as exc:
        validate_arguments("read_file", schema, {})
    assert "path" in str(exc.value.details["summary"])


def test_schema_rejects_a_wrong_type():
    schema = {"type": "object", "properties": {"n": {"type": "integer"}}}
    with pytest.raises(SchemaInvalid):
        validate_arguments("t", schema, {"n": "not a number"})


def test_schema_rejects_an_undeclared_property_when_closed():
    schema = {
        "type": "object",
        "properties": {"a": {"type": "string"}},
        "additionalProperties": False,
    }
    with pytest.raises(SchemaInvalid):
        validate_arguments("t", schema, {"a": "x", "b": "y"})


def test_schema_reports_every_violation_at_once():
    schema = {
        "type": "object",
        "properties": {"a": {"type": "string"}, "b": {"type": "integer"}},
        "required": ["a", "b"],
    }
    with pytest.raises(SchemaInvalid) as exc:
        validate_arguments("t", schema, {"a": 1, "b": "x"})
    assert len(exc.value.details["violations"]) >= 2


def test_schema_enforces_enum_and_bounds():
    schema = {
        "type": "object",
        "properties": {
            "mode": {"type": "string", "enum": ["fast", "slow"]},
            "n": {"type": "integer", "minimum": 1, "maximum": 5},
        },
    }
    with pytest.raises(SchemaInvalid):
        validate_arguments("t", schema, {"mode": "medium"})
    with pytest.raises(SchemaInvalid):
        validate_arguments("t", schema, {"n": 99})
    assert validate_arguments("t", schema, {"mode": "fast", "n": 3})


def test_schema_rejects_non_object_arguments():
    with pytest.raises(SchemaInvalid, match="JSON object"):
        validate_arguments("t", {"type": "object"}, ["not", "a", "dict"])


def test_empty_schema_accepts_anything():
    assert validate_arguments("t", None, {"anything": 1}) == {"anything": 1}
    assert validate_arguments("t", {}, {}) == {}


@pytest.mark.parametrize(
    "schema,ok",
    [
        (None, True),
        ({}, True),
        ({"type": "object"}, True),
        ({"type": "string"}, False),
        ({"$ref": "#/defs/x"}, False),
        ({"anyOf": []}, False),
        ("not a dict", False),
    ],
)
def test_schema_soundness_check(schema, ok):
    assert is_valid_tool_schema(schema)[0] is ok


# ---------------------------------------------------------------- results


def test_result_normalises_text_content():
    r = normalise_result("read_file", "fs", {"content": [{"type": "text", "text": "hi"}]})
    assert r.ok and r.text == "hi"
    assert r.result_hash


def test_result_flags_is_error():
    r = normalise_result(
        "boom", "fs", {"content": [{"type": "text", "text": "nope"}], "isError": True}
    )
    assert not r.ok
    assert r.is_error


def test_result_keeps_structured_content():
    r = normalise_result(
        "t", "fs", {"content": [], "structuredContent": {"count": 3}}
    )
    assert r.structured == {"count": 3}
    assert '"count":3' in r.text


def test_result_truncates_oversized_text():
    r = normalise_result("t", "fs", {"content": [{"type": "text", "text": "x" * 200_000}]})
    assert r.truncated
    assert len(r.text) < 200_000


def test_result_handles_resource_blocks():
    r = normalise_result(
        "t",
        "fs",
        {
            "content": [
                {
                    "type": "resource",
                    "resource": {"uri": "file:///a.txt", "text": "body", "mimeType": "text/plain"},
                }
            ]
        },
    )
    assert "file:///a.txt" in r.text
    assert "body" in r.text


def test_result_accepts_a_plain_string():
    r = normalise_result("t", "fs", "just text")
    assert r.text == "just text"


def test_result_hashes_are_deterministic():
    a = normalise_result("t", "fs", {"content": [{"type": "text", "text": "x"}]})
    b = normalise_result("t", "fs", {"content": [{"type": "text", "text": "x"}]})
    assert a.result_hash == b.result_hash


def test_failure_helper_marks_not_ok():
    r = CallResult.failure("t", "fs", "boom")
    assert not r.ok and r.is_error and r.error == "boom"
