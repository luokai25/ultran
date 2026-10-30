"""Forge: compile and sign a connector/agent/plugin bundle.

A forge compile does three things:

1. **syntax + safety checks** - no ``eval``/``exec``, no dynamic import of
   remote code, no obvious secret literals;
2. **manifest derivation** - the export block is what the registry would need to
   load the artifact;
3. **checksum** - a stable SHA-256 over name + kind + source, so the same input
   always signs the same, and a tampered bundle cannot masquerade as a signed one.
"""

from __future__ import annotations

import ast
import hashlib
import re
from typing import Any

from .errors import ValidationFailed

KINDS = {"connector", "agent", "plugin"}
_BANNED_CALLS = {"eval", "exec", "compile", "__import__"}
_BANNED_MODULES = {"subprocess", "ctypes", "pty", "pickle"}
_SECRET_PATTERNS = (
    (re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*=\s*['\"][A-Za-z0-9_\-]{16,}['\"]"), "inline secret literal"),
    (re.compile(r"https?://[^\s'\"]+\.(py|sh|js)"), "remote code reference"),
)
_SECRET_NAME_RE = re.compile(r"(?i)^(api[_-]?key|secret|token|password|access[_-]?key|private[_-]?key)$")


class ForgeService:
    def compile(self, *, name: str, kind: str, source: str, strict: bool = True) -> dict[str, Any]:
        if kind not in KINDS:
            raise ValidationFailed("unsupported kind", details={"kind": kind, "valid": sorted(KINDS)})
        if not name.strip():
            raise ValidationFailed("name must not be empty")
        if not source.strip():
            raise ValidationFailed("source must not be empty")

        diagnostics: list[str] = []
        ok = True

        # 1. parse
        try:
            tree = ast.parse(source)
        except SyntaxError as exc:
            return {
                "name": name,
                "kind": kind,
                "ok": False,
                "diagnostics": [f"syntax error: {exc.msg} at line {exc.lineno}"],
                "export": {},
                "checksum": self._checksum(name, kind, source),
            }

        # 2. safety walk
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                if node.func.id in _BANNED_CALLS:
                    diagnostics.append(f"line {node.lineno}: call to banned builtin '{node.func.id}'")
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [a.name for a in node.names] if isinstance(node, ast.Import) else ([node.module] if node.module else [])
                for mod in names:
                    root = (mod or "").split(".")[0]
                    if root in _BANNED_MODULES:
                        diagnostics.append(f"line {node.lineno}: import of restricted module '{root}'")
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                for pattern, label in _SECRET_PATTERNS:
                    if pattern.search(node.value):
                        diagnostics.append(f"line {node.lineno}: possible {label}")
                        break
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
                if any(_SECRET_NAME_RE.match(t) for t in targets):
                    value = node.value.value
                    if len(value) >= 16 and " " not in value:
                        diagnostics.append(
                            f"line {node.lineno}: possible inline secret literal"
                        )

        if diagnostics and strict:
            ok = False

        export = {
            "kind": kind,
            "name": name,
            "entry": self._entry(tree),
            "exports": self._exports(tree),
            "safe": ok,
            "diagnostics": diagnostics,
        }
        return {
            "name": name,
            "kind": kind,
            "ok": ok,
            "diagnostics": diagnostics,
            "export": export,
            "checksum": self._checksum(name, kind, source),
        }

    # ------------------------------------------------------------------ #
    @staticmethod
    def _checksum(name: str, kind: str, source: str) -> str:
        h = hashlib.sha256()
        h.update(name.encode("utf-8"))
        h.update(b"\x00")
        h.update(kind.encode("utf-8"))
        h.update(b"\x00")
        h.update(source.encode("utf-8"))
        return h.hexdigest()

    @staticmethod
    def _entry(tree: ast.AST) -> str:
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in {"handle", "main", "run", "execute"}:
                return node.name
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                return node.name
        return ""

    @staticmethod
    def _exports(tree: ast.AST) -> list[str]:
        names: list[str] = []
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.append(node.name)
        return names
