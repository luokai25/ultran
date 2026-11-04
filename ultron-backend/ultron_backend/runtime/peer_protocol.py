"""Explicitly paired, signed peer RPC protocol primitives.

No LAN discovery, socket listener, command execution, or secret exchange occurs
here. A transport adapter may send only verified, allow-listed messages to a
separate dispatcher. Pairing requires explicit user consent.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit


MAX_MESSAGE_BYTES = 64 * 1024
MAX_CLOCK_SKEW_SECONDS = 120
MAX_REPLAY_ENTRIES = 4096


class PeerProtocolError(ValueError):
    pass


def validate_peer_endpoint(endpoint: str) -> str:
    if not isinstance(endpoint, str) or len(endpoint) > 512:
        raise PeerProtocolError("Peer endpoint is invalid.")
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"ws", "wss"} or not parsed.hostname or parsed.username or parsed.password:
        raise PeerProtocolError("Peer endpoint must be an explicit ws:// or wss:// URL without credentials.")
    if parsed.fragment:
        raise PeerProtocolError("Peer endpoint fragments are not allowed.")
    if parsed.scheme == "ws":
        try:
            address = ipaddress.ip_address(parsed.hostname)
            safe_local = address.is_private or address.is_loopback or address.is_link_local
        except ValueError:
            safe_local = parsed.hostname.lower() in {"localhost"}
        if not safe_local:
            raise PeerProtocolError("Unencrypted ws:// is restricted to explicitly paired local-network endpoints.")
    return endpoint.rstrip("/")


def canonical_message(body: dict[str, Any]) -> bytes:
    try:
        encoded = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise PeerProtocolError("Peer message is not canonical JSON.") from exc
    if len(encoded) > MAX_MESSAGE_BYTES:
        raise PeerProtocolError("Peer message exceeds the payload limit.")
    return encoded


@dataclass(frozen=True)
class PairedPeer:
    peer_id: str
    endpoint: str
    shared_key: bytes
    allowed_methods: frozenset[str]
    requests_per_minute: int = 30


@dataclass(frozen=True)
class VerifiedPeerMessage:
    peer_id: str
    message_id: str
    method: str
    payload: dict[str, Any]
    issued_at: int


class PeerRegistry:
    def __init__(self) -> None:
        self._peers: dict[str, PairedPeer] = {}
        self._seen: OrderedDict[tuple[str, str], int] = OrderedDict()
        self._requests: dict[str, list[int]] = {}

    def pair(
        self, peer_id: str, endpoint: str, shared_key: bytes,
        allowed_methods: set[str], *, user_consented: bool,
        requests_per_minute: int = 30,
    ) -> PairedPeer:
        if not user_consented:
            raise PeerProtocolError("Pairing requires explicit user consent.")
        if peer_id not in self._peers and len(self._peers) >= 128:
            raise PeerProtocolError("The paired-node limit has been reached.")
        if not peer_id or len(peer_id) > 80 or not peer_id.replace("-", "").replace("_", "").isalnum():
            raise PeerProtocolError("Peer id is invalid.")
        if not isinstance(shared_key, bytes) or len(shared_key) != 32:
            raise PeerProtocolError("A 32-byte out-of-band pairing key is required.")
        methods = frozenset(allowed_methods)
        if not methods or any(not method or len(method) > 80 or not method.replace(".", "").replace("_", "a").isalnum() for method in methods):
            raise PeerProtocolError("An explicit method allow-list is required.")
        if not 1 <= requests_per_minute <= 600:
            raise PeerProtocolError("Peer request quota is outside the supported range.")
        peer = PairedPeer(peer_id, validate_peer_endpoint(endpoint), bytes(shared_key), methods, requests_per_minute)
        self._peers[peer_id] = peer
        return peer

    def revoke(self, peer_id: str) -> None:
        self._peers.pop(peer_id, None)
        self._requests.pop(peer_id, None)
        for key in [key for key in self._seen if key[0] == peer_id]:
            self._seen.pop(key, None)

    def verify(self, envelope: dict[str, Any], *, now: int | None = None) -> VerifiedPeerMessage:
        now = int(time.time()) if now is None else int(now)
        if not isinstance(envelope, dict):
            raise PeerProtocolError("Peer envelope must be an object.")
        required = {"version", "peer_id", "message_id", "issued_at", "method", "payload", "signature"}
        if set(envelope) != required or envelope.get("version") != 1:
            raise PeerProtocolError("Peer envelope shape or version is invalid.")
        peer_id, message_id, method = envelope["peer_id"], envelope["message_id"], envelope["method"]
        if not all(isinstance(v, str) and v for v in (peer_id, message_id, method)) or len(message_id) > 128 or len(method) > 80:
            raise PeerProtocolError("Peer identity, message id, and method are required.")
        peer = self._peers.get(peer_id)
        if peer is None:
            raise PeerProtocolError("Peer is not paired.")
        if method not in peer.allowed_methods:
            raise PeerProtocolError("Peer method is not allow-listed.")
        issued_at = envelope["issued_at"]
        if isinstance(issued_at, bool) or not isinstance(issued_at, int) or abs(now - issued_at) > MAX_CLOCK_SKEW_SECONDS:
            raise PeerProtocolError("Peer message is outside the accepted clock window.")
        payload = envelope["payload"]
        if not isinstance(payload, dict):
            raise PeerProtocolError("Peer payload must be an object.")
        body = {key: envelope[key] for key in ("version", "peer_id", "message_id", "issued_at", "method", "payload")}
        encoded = canonical_message(body)
        signature = envelope["signature"]
        if not isinstance(signature, str):
            raise PeerProtocolError("Peer signature is missing.")
        try:
            raw_signature = base64.b64decode(signature, validate=True)
        except ValueError as exc:
            raise PeerProtocolError("Peer signature encoding is invalid.") from exc
        expected_signature = hmac.new(peer.shared_key, encoded, hashlib.sha256).digest()
        if not hmac.compare_digest(raw_signature, expected_signature):
            raise PeerProtocolError("Peer signature verification failed.")

        replay_key = (peer_id, message_id)
        if replay_key in self._seen:
            raise PeerProtocolError("Peer message replay detected.")
        recent = [stamp for stamp in self._requests.get(peer_id, []) if now - stamp < 60]
        if len(recent) >= peer.requests_per_minute:
            raise PeerProtocolError("Peer request quota exceeded.")
        recent.append(now)
        self._requests[peer_id] = recent
        self._seen[replay_key] = now
        while len(self._seen) > MAX_REPLAY_ENTRIES:
            self._seen.popitem(last=False)
        for key, stamp in list(self._seen.items()):
            if now - stamp > MAX_CLOCK_SKEW_SECONDS:
                self._seen.pop(key, None)
        return VerifiedPeerMessage(peer_id, message_id, method, payload, issued_at)


def sign_peer_message(
    shared_key: bytes, peer_id: str, method: str, payload: dict[str, Any],
    *, message_id: str, issued_at: int | None = None,
) -> dict[str, Any]:
    """Helper for tests and paired-node adapters; key is exchanged out of band."""
    body = {
        "version": 1,
        "peer_id": peer_id,
        "message_id": message_id,
        "issued_at": int(time.time()) if issued_at is None else int(issued_at),
        "method": method,
        "payload": payload,
    }
    signature = hmac.new(shared_key, canonical_message(body), hashlib.sha256).digest()
    return {**body, "signature": base64.b64encode(signature).decode("ascii")}
