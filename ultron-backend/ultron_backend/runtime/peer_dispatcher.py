"""Verified peer message dispatcher, transport-independent.

A WebSocket/HTTP adapter can call this after receiving one JSON envelope. Only
health.ping and memory.merge are implemented; tool execution, shell commands,
deployment and other external effects are deliberately not remote RPC methods.
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .peer_protocol import PeerProtocolError, PeerRegistry
from .replicated_state import ReplicatedState, StateEvent, ReplicatedStateError


class PeerDispatchError(ValueError):
    pass


class PeerDispatcher:
    def __init__(self, node_id: str, peers: PeerRegistry, state: ReplicatedState) -> None:
        self.node_id = node_id
        self.peers = peers
        self.state = state

    def handle(self, envelope: dict[str, Any], *, now: int | None = None) -> dict[str, Any]:
        try:
            message = self.peers.verify(envelope, now=now)
        except PeerProtocolError as exc:
            raise PeerDispatchError(str(exc)) from exc

        if message.method == "health.ping":
            if message.payload:
                raise PeerDispatchError("health.ping does not accept payload fields.")
            return {
                "ok": True,
                "method": "health.pong",
                "node_id": self.node_id,
                "lamport": self.state.lamport,
                "state_digest": self.state.digest(),
            }

        if message.method == "memory.merge":
            if set(message.payload) != {"events"} or not isinstance(message.payload["events"], list):
                raise PeerDispatchError("memory.merge requires an events array and no other fields.")
            events: list[StateEvent] = []
            for raw in message.payload["events"]:
                if not isinstance(raw, dict) or set(raw) != {"event_id", "actor_id", "lamport", "key", "value", "deleted"}:
                    raise PeerDispatchError("Replicated state event has an invalid shape.")
                events.append(StateEvent(
                    event_id=raw["event_id"],
                    actor_id=raw["actor_id"],
                    lamport=raw["lamport"],
                    key=raw["key"],
                    value=raw["value"],
                    deleted=raw["deleted"],
                ))
            try:
                merged = self.state.merge(events)
            except ReplicatedStateError as exc:
                raise PeerDispatchError(str(exc)) from exc
            return {
                "ok": True,
                "method": "memory.merged",
                "accepted_events": merged,
                "lamport": self.state.lamport,
                "state_digest": self.state.digest(),
            }

        raise PeerDispatchError("Peer method has no dispatcher implementation.")
