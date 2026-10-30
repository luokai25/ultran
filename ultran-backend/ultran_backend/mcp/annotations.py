"""Tool annotations, capability derivation and sensitivity.

MCP gives a server three ways to describe a tool:

* ``annotations`` - the spec's hints (``readOnlyHint``, ``destructiveHint``,
  ``idempotentHint``, ``openWorldHint``);
* ``_meta`` - free-form, and where a server can declare Ultran-specific
  capabilities (``{"ultran/capabilities": ["read", "network"]}``);
* the tool's **name** - the only signal a server that declares nothing leaves us.

The v2 spec asks for exactly one thing here: *"move it into the tool spec as an
annotation so MCP tools declare their own sensitivity"*. So the mapping is
deliberately conservative - a tool that says nothing is treated as a writer, not
a reader, because under-declaring a capability is how a read-only grant becomes a
delete.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

CAPABILITIES: frozenset[str] = frozenset(
    {"read", "write", "delete", "execute", "network", "admin"}
)

#: Capabilities that change state outside the process.
MUTATING_CAPABILITIES: frozenset[str] = frozenset({"write", "delete", "execute", "admin"})

#: Capabilities that can always be granted to an unattended run.
SAFE_CAPABILITIES: frozenset[str] = frozenset({"read"})

# Verbs that betray intent when a server declares no annotations. Order matters:
# the first match wins, and destructive verbs are checked before write verbs so
# ``delete_repository`` is not read as a plain write.
_DELETE_VERBS = (
    "delete",
    "remove",
    "drop",
    "destroy",
    "purge",
    "truncate",
    "erase",
    "revoke",
    "unlink",
    "wipe",
    "kill",
)
_EXECUTE_VERBS = (
    "exec",
    "execute",
    "run_command",
    "shell",
    "spawn",
    "system",
    "eval",
    "invoke",
    "deploy",
    "apply",
)
_WRITE_VERBS = (
    "create",
    "update",
    "write",
    "put",
    "patch",
    "post",
    "send",
    "publish",
    "commit",
    "push",
    "merge",
    "upload",
    "insert",
    "upsert",
    "append",
    "set",
    "add",
    "move",
    "rename",
    "share",
    "charge",
    "pay",
    "transition",
    "complete",
)
_READ_VERBS = (
    "list",
    "get",
    "read",
    "search",
    "find",
    "fetch",
    "describe",
    "inspect",
    "show",
    "query",
    "stat",
    "count",
    "head",
    "diff",
    "download",
    "export",
    "view",
    "lookup",
    "resolve",
)

#: Verbs that mean "this leaves the machine or reaches a third party".
_SENSITIVE_VERBS = (
    "send",
    "post",
    "publish",
    "share",
    "commit",
    "push",
    "merge",
    "deploy",
    "charge",
    "pay",
    "delete",
    "drop",
    "destroy",
    "purge",
    "revoke",
    "exec",
    "execute",
    "shell",
    "run_command",
    "upload",
    "transition",
)


def _tokens(name: str) -> list[str]:
    """Split ``readFile``, ``read_file`` and ``fs.read-file`` into words."""
    out: list[str] = []
    current = ""
    for ch in name:
        if ch.isalnum():
            if ch.isupper() and current and not current[-1].isupper():
                out.append(current.lower())
                current = ch
            else:
                current += ch
        else:
            if current:
                out.append(current.lower())
                current = ""
    if current:
        out.append(current.lower())
    return out


def _has_verb(name: str, verbs: Iterable[str]) -> bool:
    tokens = _tokens(name)
    joined = "_".join(tokens)
    for verb in verbs:
        if "_" in verb:
            if joined.startswith(verb) or f"_{verb}" in joined:
                return True
        elif tokens and tokens[0] == verb or any(token == verb for token in tokens[:2]):
            return True
    return False


def _clean_capabilities(values: Any, *, where: str) -> frozenset[str]:
    if values is None:
        return frozenset()
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, (list, tuple, set, frozenset)):
        raise TypeError(f"{where} must be a list of capability names")
    out: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            raise TypeError(f"{where} entries must be strings")
        cap = value.strip().lower()
        if cap not in CAPABILITIES:
            # "Deny by default; unknown capability => deny" (spec, module contracts).
            raise ValueError(f"unknown capability {value!r} in {where}")
        out.add(cap)
    return frozenset(out)


@dataclass(frozen=True)
class ToolAnnotations:
    """The capability view of one MCP tool.

    ``declared`` records whether the server said anything at all, so callers can
    distinguish "this tool is read-only" from "we guessed it is read-only".
    """

    capabilities: frozenset[str] = frozenset({"write"})
    read_only: bool = False
    destructive: bool = False
    idempotent: bool = False
    open_world: bool = False
    requires_approval: bool = False
    title: str = ""
    declared: bool = False

    # ------------------------------------------------------------------ #
    @property
    def mutating(self) -> bool:
        return bool(self.capabilities & MUTATING_CAPABILITIES)

    def covers(self, required: Iterable[str]) -> bool:
        return set(required).issubset(self.capabilities)

    def to_dict(self) -> dict[str, Any]:
        return {
            "capabilities": sorted(self.capabilities),
            "read_only": self.read_only,
            "destructive": self.destructive,
            "idempotent": self.idempotent,
            "open_world": self.open_world,
            "requires_approval": self.requires_approval,
            "title": self.title,
            "declared": self.declared,
        }

    # ------------------------------------------------------------------ #
    @classmethod
    def from_wire(
        cls,
        name: str,
        *,
        annotations: Mapping[str, Any] | None = None,
        meta: Mapping[str, Any] | None = None,
    ) -> ToolAnnotations:
        """Derive capabilities from a wire ``Tool``.

        Priority: an explicit ``ultran/capabilities`` declaration, then the
        spec's hints, then verb heuristics on the tool name.
        """
        annotations = dict(annotations or {})
        meta = dict(meta or {})
        read_only = bool(annotations.get("readOnlyHint", False))
        destructive = bool(annotations.get("destructiveHint", False))
        idempotent = bool(annotations.get("idempotentHint", False))
        open_world = bool(annotations.get("openWorldHint", False))
        title = str(annotations.get("title") or meta.get("title") or "")

        explicit = meta.get("ultran/capabilities")
        if explicit is None and "capabilities" in annotations:
            explicit = annotations.get("capabilities")
        declared = False
        caps: set[str] = set()
        if explicit is not None:
            caps |= set(_clean_capabilities(explicit, where=f"{name}.capabilities"))
            declared = True

        if not caps:
            # No explicit declaration: fall back to hints, then to the name.
            hinted: set[str] = set()
            if read_only:
                hinted.add("read")
            if destructive:
                hinted |= {"write", "delete"}
            if open_world:
                hinted.add("network")
            if hinted:
                declared = True
            else:
                hinted = _infer_capabilities(name)
            caps = hinted

        # Hints refine an explicit declaration rather than being ignored.
        if destructive:
            caps |= {"write", "delete"}
        if open_world:
            caps.add("network")
        if read_only and not destructive and "write" not in caps and "delete" not in caps:
            caps.add("read")

        requires_approval = bool(
            annotations.get("requiresApproval")
            or meta.get("ultran/requires_approval")
            or destructive
            or (caps & {"delete", "execute", "admin"})
            or _has_verb(name, _SENSITIVE_VERBS)
        )
        if read_only and not destructive and not (caps & {"delete", "execute", "admin"}):
            requires_approval = requires_approval and _has_verb(name, _SENSITIVE_VERBS)

        return cls(
            capabilities=frozenset(caps),
            read_only=read_only or caps == {"read"},
            destructive=destructive or "delete" in caps,
            idempotent=idempotent,
            open_world=open_world,
            requires_approval=requires_approval,
            title=title,
            declared=declared,
        )


def _infer_capabilities(name: str) -> set[str]:
    if _has_verb(name, _DELETE_VERBS):
        return {"write", "delete"}
    if _has_verb(name, _EXECUTE_VERBS):
        return {"write", "execute"}
    if _has_verb(name, _READ_VERBS) and not _has_verb(name, _WRITE_VERBS):
        return {"read"}
    if _has_verb(name, _WRITE_VERBS):
        return {"write"}
    # Unknown verb: assume the least privilege that still lets it do its job.
    return {"write"}


def capability_filter(allowed: Iterable[str] | None) -> frozenset[str] | None:
    """Normalise a granted capability set; ``None`` means "no filtering"."""
    if allowed is None:
        return None
    caps = {str(c).strip().lower() for c in allowed if str(c).strip()}
    unknown = caps - CAPABILITIES
    if unknown:
        raise ValueError(f"unknown capabilities: {sorted(unknown)}")
    return frozenset(caps)


__all__ = [
    "CAPABILITIES",
    "MUTATING_CAPABILITIES",
    "SAFE_CAPABILITIES",
    "ToolAnnotations",
    "capability_filter",
]
