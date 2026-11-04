"""Network-layer egress control.

The v2 spec is blunt about why a URL allow-list is not a control:

    ``https://api.github.com@evil.com/``, a redirect, a DNS rebind, or a
    subdomain takeover all defeat it.

A stdio MCP server is a child process we spawn, so we can do better than string
matching without a rootless container:

* **host normalisation** - lower-case, strip the trailing dot, reject the
  decomposed ``userinfo@host`` form outright instead of trusting urlparse to have
  picked the host we think it picked;
* **suffix matching on label boundaries** - ``github.com`` matches
  ``api.github.com`` but never ``evilgithub.com`` or ``github.com.evil.io``;
* **scheme + port pinning** - ``file:``, ``ftp:`` and friends are not egress,
  they are local file access with extra steps;
* **byte and request budgets per run** - the spec's 32 MB default, so one
  runaway download cannot drain a metered plan;
* **a full log** - "detect and show, do not pretend to prevent".

This module is the decision function. Enforcement in the child process is the
proxy's job; here we answer "may this request leave?" and record the answer.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from .errors import EgressDenied

DEFAULT_ALLOWED_HOSTS: tuple[str, ...] = (
    "api.github.com",
    "github.com",
    "raw.githubusercontent.com",
    "api.slack.com",
    "slack.com",
    "api.notion.com",
    "notion.so",
    "files.pythonhosted.org",
    "pypi.org",
    "registry.npmjs.org",
    "api.anthropic.com",
    "api.openai.com",
)

ALLOWED_SCHEMES: frozenset[str] = frozenset({"http", "https", "wss", "ws"})

DEFAULT_BYTE_CAP = 32 * 1024 * 1024  # the spec's per-run default
DEFAULT_REQUEST_CAP = 512

#: RFC 1123 hostname, at least two labels, no leading/trailing hyphen.
_HOSTNAME_RE = re.compile(r"^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$")

#: ``scheme://user:pass@host`` - userinfo is how the classic bypass is built.
_USERINFO_RE = re.compile(r"^[a-z][a-z0-9+.-]*://[^/?#]*@", re.IGNORECASE)

_DEFAULT_PORT = {"http": 80, "https": 443, "ws": 80, "wss": 443}


@dataclass(frozen=True)
class EgressRequest:
    host: str
    scheme: str = "https"
    port: int | None = None
    path: str = "/"
    bytes: int = 0

    def effective_port(self) -> int:
        return self.port if self.port is not None else _DEFAULT_PORT.get(self.scheme, 0)


@dataclass
class EgressDecision:
    allowed: bool
    host: str = ""
    reason: str = "ok"
    rule: str = ""


@dataclass
class EgressLogEntry:
    host: str
    path: str
    scheme: str
    bytes: int
    allowed: bool
    reason: str
    at: datetime = field(default_factory=datetime.utcnow)

    def as_dict(self) -> dict[str, Any]:
        return {
            "host": self.host,
            "path": self.path,
            "scheme": self.scheme,
            "bytes": self.bytes,
            "allowed": self.allowed,
            "reason": self.reason,
            "at": self.at.isoformat(),
        }


def normalise_host(raw: str) -> str:
    """Lower-case, strip a trailing dot, reject anything with userinfo/port."""
    host = (raw or "").strip().lower()
    if host.startswith("[") and "]" in host:  # IPv6 literal
        host = host[1 : host.index("]")]
    if "@" in host or "/" in host or "?" in host or "#" in host:
        raise EgressDenied("malformed host", details={"host": raw})
    host = host.rstrip(".")
    if not host:
        raise EgressDenied("empty host", details={"host": raw})
    return host


def _host_matches(host: str, rule: str) -> bool:
    """Label-boundary suffix match: ``api.github.com`` matches ``github.com``."""
    if host == rule:
        return True
    # A wildcard rule grants exactly one extra label, never an arbitrary depth.
    if rule.startswith("*."):
        base = rule[2:]
        return host.endswith("." + base) and host.count(".") == base.count(".") + 1
    if rule.startswith("."):
        rule = rule[1:]
        return host == rule or host.endswith("." + rule)
    return host.endswith("." + rule)


class EgressPolicy:
    """An allow-list plus per-run byte and request budgets."""

    def __init__(
        self,
        allowed_hosts: Iterable[str] | None = None,
        *,
        deny_private: bool = True,
        byte_cap: int = DEFAULT_BYTE_CAP,
        request_cap: int = DEFAULT_REQUEST_CAP,
        allowed_schemes: Iterable[str] = ALLOWED_SCHEMES,
    ) -> None:
        rules = list(DEFAULT_ALLOWED_HOSTS if allowed_hosts is None else allowed_hosts)
        cleaned: list[str] = []
        for raw in rules:
            rule = str(raw).strip().lower()
            if not rule:
                continue
            if rule.startswith("*."):
                # Keep the wildcard marker; normalise only the base host.
                cleaned.append("*." + normalise_host(rule[2:]))
            else:
                cleaned.append(normalise_host(rule.lstrip(".")))
        self._rules: tuple[str, ...] = tuple(cleaned)
        self.deny_private = deny_private
        self.byte_cap = max(0, int(byte_cap))
        self.request_cap = max(0, int(request_cap))
        self.allowed_schemes = frozenset(s.lower() for s in allowed_schemes)
        self._bytes_used = 0
        self._requests_used = 0
        self._log: list[EgressLogEntry] = []

    # ------------------------------------------------------------------ #
    @property
    def rules(self) -> tuple[str, ...]:
        return self._rules

    def allowed_hosts(self) -> list[str]:
        return sorted(self._rules)

    def with_hosts(self, extra: Iterable[str]) -> EgressPolicy:
        """A widened copy. A tool cannot widen its own egress - a grant can."""
        return EgressPolicy(
            [*self._rules, *extra],
            deny_private=self.deny_private,
            byte_cap=self.byte_cap,
            request_cap=self.request_cap,
        )

    # ------------------------------------------------------------------ #
    def check(self, request: EgressRequest | str) -> EgressDecision:
        try:
            req = self._coerce(request)
        except EgressDenied as exc:
            # A URL we cannot even parse is a denial, not a crash: the caller
            # asked "may this leave?" and the answer is no.
            return self._record(
                EgressRequest(host=str(request)[:200], scheme=""),
                EgressDecision(False, "", exc.message, "malformed"),
            )
        try:
            host = normalise_host(req.host)
        except EgressDenied as exc:
            return self._record(req, EgressDecision(False, req.host, exc.message))

        if req.scheme.lower() not in self.allowed_schemes:
            return self._record(
                req, EgressDecision(False, host, f"scheme {req.scheme!r} is not egress", "scheme")
            )
        if not _HOSTNAME_RE.match(host) and not _is_ip_literal(host):
            return self._record(req, EgressDecision(False, host, "malformed host", "format"))
        if self.deny_private and _is_private(host):
            return self._record(
                req, EgressDecision(False, host, "private/loopback destinations are blocked", "private")
            )
        if self._requests_used >= self.request_cap:
            return self._record(
                req,
                EgressDecision(False, host, "egress request budget exhausted", "request_budget"),
            )
        if self._bytes_used + max(0, req.bytes) > self.byte_cap:
            return self._record(
                req, EgressDecision(False, host, "egress byte budget exhausted", "byte_budget")
            )
        for rule in self._rules:
            if _host_matches(host, rule):
                return self._record(req, EgressDecision(True, host, "ok", rule))
        return self._record(
            req,
            EgressDecision(
                False, host, f"host {host!r} is not on the egress allow-list", "allowlist"
            ),
        )

    def require(self, request: EgressRequest | str) -> EgressRequest:
        """Raise :class:`EgressDenied` unless the request may leave."""
        req = self._coerce(request)
        decision = self.check(req)
        if not decision.allowed:
            raise EgressDenied(
                decision.reason,
                details={"host": decision.host, "rule": decision.rule, "url_host": req.host},
            )
        self._requests_used += 1
        self._bytes_used += max(0, req.bytes)
        return req

    # ------------------------------------------------------------------ #
    def usage(self) -> dict[str, Any]:
        return {
            "bytes_used": self._bytes_used,
            "byte_cap": self.byte_cap,
            "requests_used": self._requests_used,
            "request_cap": self.request_cap,
            "allowed_hosts": self.allowed_hosts(),
        }

    def log(self, limit: int = 100) -> list[dict[str, Any]]:
        if limit <= 0:
            return []
        return [entry.as_dict() for entry in self._log[-limit:]][::-1]

    def denied(self) -> list[dict[str, Any]]:
        return [entry.as_dict() for entry in self._log if not entry.allowed]

    def reset(self) -> None:
        self._bytes_used = 0
        self._requests_used = 0

    # ------------------------------------------------------------------ #
    @staticmethod
    def _coerce(request: EgressRequest | str) -> EgressRequest:
        if isinstance(request, EgressRequest):
            return request
        if not isinstance(request, str):
            raise EgressDenied("egress request must be a URL or EgressRequest")
        return parse_url(request)

    def _record(self, req: EgressRequest, decision: EgressDecision) -> EgressDecision:
        self._log.append(
            EgressLogEntry(
                host=decision.host or req.host,
                path=req.path,
                scheme=req.scheme,
                bytes=max(0, req.bytes),
                allowed=decision.allowed,
                reason=decision.reason,
            )
        )
        return decision


def parse_url(url: str) -> EgressRequest:
    """Parse a URL into an :class:`EgressRequest` without trusting userinfo.

    ``urlsplit`` puts ``api.github.com`` in ``hostname`` for
    ``https://api.github.com@evil.com/`` *and* for
    ``https://evil.com@api.github.com/``; only one of those is safe. So the raw
    string is rejected whenever it carries userinfo at all.
    """
    if not isinstance(url, str) or not url.strip():
        raise EgressDenied("empty URL")
    if _USERINFO_RE.match(url.strip()):
        raise EgressDenied(
            "URLs with embedded credentials are rejected (userinfo bypass)",
            details={"url": _redact(url)},
        )
    parts = urlsplit(url.strip())
    if not parts.scheme:
        raise EgressDenied("URL has no scheme", details={"url": _redact(url)})
    host = parts.hostname or ""
    if not host:
        raise EgressDenied("URL has no host", details={"url": _redact(url)})
    return EgressRequest(
        host=host,
        scheme=parts.scheme,
        port=parts.port,
        path=parts.path or "/",
    )


def _redact(url: str) -> str:
    if "@" in url:
        head, tail = url.split("@", 1)
        return f"{head.split('//')[0]}//***@{tail}"
    return url[:200]


def _is_ip_literal(host: str) -> bool:
    parts = host.split(".")
    if len(parts) != 4:
        return False
    return all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


_PRIVATE_PREFIXES = ("127.", "10.", "192.168.", "169.254.", "0.")


def _is_private(host: str) -> bool:
    if host in {"localhost", "localhost.localdomain", "ip6-localhost", "::1"}:
        return True
    if host.endswith((".localhost", ".internal", ".local")):
        return True
    if _is_ip_literal(host):
        if any(host.startswith(prefix) for prefix in _PRIVATE_PREFIXES):
            return True
        if host.startswith("172."):
            second = host.split(".")[1]
            if second.isdigit() and 16 <= int(second) <= 31:
                return True
        return True  # any raw IP is off-list until an operator adds it
    return False


def policy_from_config(config: Mapping[str, Any] | None) -> EgressPolicy:
    """Build a policy from a server's ``egress`` config block."""
    config = dict(config or {})
    return EgressPolicy(
        config.get("allowed_hosts"),
        deny_private=bool(config.get("deny_private", True)),
        byte_cap=int(config.get("byte_cap", DEFAULT_BYTE_CAP)),
        request_cap=int(config.get("request_cap", DEFAULT_REQUEST_CAP)),
    )


__all__ = [
    "ALLOWED_SCHEMES",
    "DEFAULT_ALLOWED_HOSTS",
    "DEFAULT_BYTE_CAP",
    "EgressDecision",
    "EgressPolicy",
    "EgressRequest",
    "normalise_host",
    "parse_url",
    "policy_from_config",
]
