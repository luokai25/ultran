"""Static policy for generated ULTRON tool source.

This module parses source but never runs it. AST screening is only one layer;
production activation must route through a separately isolated MCP/worker runtime.
"""

from __future__ import annotations

import ast
import hashlib
import re
from dataclasses import dataclass

TOOL_ID = re.compile(r"^[a-z][a-z0-9_]{1,47}$")
MAX_SOURCE_BYTES = 32_000
SAFE_CALLS = {"abs", "all", "any", "bool", "dict", "enumerate", "float", "int", "len", "list", "max", "min", "range", "round", "set", "sorted", "str", "sum", "tuple", "zip"}
SAFE_NODES = {
    ast.Module, ast.FunctionDef, ast.arguments, ast.arg, ast.Return, ast.Assign,
    ast.AnnAssign, ast.AugAssign, ast.If, ast.For, ast.Expr, ast.Pass, ast.Break,
    ast.Continue, ast.List, ast.Tuple, ast.Dict, ast.Set, ast.Constant, ast.Name,
    ast.Load, ast.Store, ast.Subscript, ast.Slice, ast.BinOp, ast.UnaryOp,
    ast.BoolOp, ast.Compare, ast.IfExp, ast.Call, ast.keyword, ast.ListComp,
    ast.SetComp, ast.DictComp, ast.comprehension, ast.Add, ast.Sub, ast.Mult,
    ast.Div, ast.FloorDiv, ast.Mod, ast.USub, ast.UAdd, ast.Not, ast.And, ast.Or,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn,
    ast.Is, ast.IsNot,
}


class GeneratedToolPolicyError(ValueError):
    """Generated source violates the supported tool language."""


@dataclass(frozen=True)
class SourceReview:
    accepted: bool
    sha256: str
    byte_count: int
    function_name: str
    findings: tuple[str, ...]


def review_generated_source(source: str) -> SourceReview:
    if not isinstance(source, str) or not source.strip():
        raise GeneratedToolPolicyError("Generated source is empty.")
    size = len(source.encode("utf-8"))
    if size > MAX_SOURCE_BYTES:
        raise GeneratedToolPolicyError("Generated source exceeds the 32 KB limit.")
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as exc:
        raise GeneratedToolPolicyError(f"Syntax error at line {exc.lineno}: {exc.msg}") from exc
    if len(tree.body) != 1 or not isinstance(tree.body[0], ast.FunctionDef):
        raise GeneratedToolPolicyError("Source must contain exactly one top-level function.")
    fn = tree.body[0]
    if fn.name != "run" or fn.decorator_list or fn.returns is not None:
        raise GeneratedToolPolicyError("Only a plain run(payload) entry point is supported.")
    if len(fn.args.args) != 1 or fn.args.args[0].arg != "payload":
        raise GeneratedToolPolicyError("The entry point must have the signature run(payload).")
    if fn.args.vararg or fn.args.kwarg or fn.args.kwonlyargs or fn.args.defaults:
        raise GeneratedToolPolicyError("Variadic arguments and defaults are not supported.")
    findings: list[str] = []
    for node in ast.walk(tree):
        if type(node) not in SAFE_NODES:
            findings.append("Unsupported syntax: " + type(node).__name__)
            continue
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            findings.append("Dunder identifiers are forbidden")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in SAFE_CALLS:
                findings.append("Call is not on the allowlist")
            if node.keywords:
                findings.append("Keyword arguments are not supported")
    if findings:
        raise GeneratedToolPolicyError("; ".join(dict.fromkeys(findings)))
    try:
        compile(tree, "<ultron-generated-tool>", "exec", dont_inherit=True, optimize=2)
    except (SyntaxError, TypeError, ValueError) as exc:
        raise GeneratedToolPolicyError(f"Bytecode compilation failed: {exc}") from exc
    return SourceReview(True, hashlib.sha256(source.encode("utf-8")).hexdigest(), size, fn.name, ())


def validate_generated_tool_id(tool_id: str) -> str:
    if not isinstance(tool_id, str) or not TOOL_ID.fullmatch(tool_id):
        raise GeneratedToolPolicyError("Tool id must be a lowercase identifier.")
    return tool_id
