"""Forge tests: parsing, safety diagnostics, signing determinism."""

from __future__ import annotations

import pytest

from ultran_backend.errors import ValidationFailed
from ultran_backend.forge import KINDS, ForgeService

GOOD = '''
"""A well-behaved connector."""


def handle(payload):
    return {"ok": True, "payload": payload}
'''


def forge() -> ForgeService:
    return ForgeService()


# --------------------------------------------------------------- happy path


def test_a_clean_bundle_compiles():
    out = forge().compile(name="demo", kind="connector", source=GOOD)
    assert out["ok"] is True
    assert out["diagnostics"] == []


def test_export_derives_the_entry_point():
    out = forge().compile(name="demo", kind="connector", source=GOOD)
    assert out["export"]["entry"] == "handle"


def test_export_lists_every_public_symbol():
    src = GOOD + "\n\nclass Thing:\n    pass\n\n\ndef other():\n    pass\n"
    out = forge().compile(name="demo", kind="plugin", source=src)
    assert set(out["export"]["exports"]) == {"handle", "Thing", "other"}


def test_entry_prefers_the_canonical_names():
    src = "def alpha():\n    pass\n\n\ndef main():\n    pass\n"
    out = forge().compile(name="demo", kind="agent", source=src)
    assert out["export"]["entry"] == "main"


def test_export_marks_a_clean_bundle_safe():
    assert forge().compile(name="demo", kind="connector", source=GOOD)["export"]["safe"] is True


@pytest.mark.parametrize("kind", sorted(KINDS))
def test_every_kind_is_compilable(kind):
    assert forge().compile(name="demo", kind=kind, source=GOOD)["ok"] is True


# ------------------------------------------------------------------ signing


def test_checksum_is_deterministic():
    a = forge().compile(name="demo", kind="connector", source=GOOD)["checksum"]
    b = forge().compile(name="demo", kind="connector", source=GOOD)["checksum"]
    assert a == b
    assert len(a) == 64


def test_checksum_changes_with_the_source():
    a = forge().compile(name="demo", kind="connector", source=GOOD)["checksum"]
    b = forge().compile(name="demo", kind="connector", source=GOOD + "\n# tweak\n")["checksum"]
    assert a != b


def test_checksum_changes_with_the_name():
    a = forge().compile(name="demo", kind="connector", source=GOOD)["checksum"]
    b = forge().compile(name="other", kind="connector", source=GOOD)["checksum"]
    assert a != b


def test_checksum_changes_with_the_kind():
    a = forge().compile(name="demo", kind="connector", source=GOOD)["checksum"]
    b = forge().compile(name="demo", kind="plugin", source=GOOD)["checksum"]
    assert a != b


# -------------------------------------------------------------- diagnostics


def test_syntax_error_is_reported_with_a_line():
    out = forge().compile(name="demo", kind="connector", source="def broken(:\n")
    assert out["ok"] is False
    assert any("syntax error" in d for d in out["diagnostics"])
    assert out["export"] == {}


def test_syntax_error_still_produces_a_checksum():
    out = forge().compile(name="demo", kind="connector", source="def broken(:\n")
    assert len(out["checksum"]) == 64


@pytest.mark.parametrize("call", ["eval", "exec", "compile", "__import__"])
def test_banned_builtins_are_flagged(call):
    src = f"def handle(x):\n    return {call}(x)\n"
    out = forge().compile(name="demo", kind="connector", source=src)
    assert out["ok"] is False
    assert any("banned builtin" in d for d in out["diagnostics"])


@pytest.mark.parametrize("mod", ["subprocess", "ctypes", "pty", "pickle"])
def test_restricted_imports_are_flagged(mod):
    src = f"import {mod}\n\n\ndef handle(x):\n    return x\n"
    out = forge().compile(name="demo", kind="connector", source=src)
    assert out["ok"] is False
    assert any("restricted module" in d for d in out["diagnostics"])


def test_an_inline_secret_literal_is_flagged():
    src = 'def handle(x):\n    api_key = "abcdef1234567890abcdef"\n    return x\n'
    out = forge().compile(name="demo", kind="connector", source=src)
    assert out["ok"] is False
    assert any("secret" in d for d in out["diagnostics"])


def test_a_remote_code_reference_is_flagged():
    src = 'URL = "https://evil.example/payload.py"\n\n\ndef handle(x):\n    return x\n'
    out = forge().compile(name="demo", kind="connector", source=src)
    assert out["ok"] is False
    assert any("remote code" in d for d in out["diagnostics"])


def test_non_strict_mode_reports_but_does_not_block():
    src = "def handle(x):\n    return eval(x)\n"
    out = forge().compile(name="demo", kind="connector", source=src, strict=False)
    assert out["ok"] is True
    assert out["diagnostics"]


def test_strict_mode_blocks_the_same_bundle():
    src = "def handle(x):\n    return eval(x)\n"
    assert forge().compile(name="demo", kind="connector", source=src)["ok"] is False


def test_a_relative_import_is_not_flagged():
    src = "from .helpers import thing\n\n\ndef handle(x):\n    return thing(x)\n"
    out = forge().compile(name="demo", kind="connector", source=src)
    assert out["ok"] is True


# --------------------------------------------------------------- validation


def test_unknown_kind_is_rejected():
    with pytest.raises(ValidationFailed, match="kind"):
        forge().compile(name="demo", kind="binary", source=GOOD)


def test_blank_name_is_rejected():
    with pytest.raises(ValidationFailed, match="name"):
        forge().compile(name="   ", kind="connector", source=GOOD)


def test_blank_source_is_rejected():
    with pytest.raises(ValidationFailed, match="source"):
        forge().compile(name="demo", kind="connector", source="   ")


def test_result_echoes_the_requested_name_and_kind():
    out = forge().compile(name="demo", kind="plugin", source=GOOD)
    assert out["name"] == "demo"
    assert out["kind"] == "plugin"
