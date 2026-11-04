"""Convergent state-only replication primitives for explicitly paired ULTRON nodes.

This is a last-writer-wins map backed by immutable events, not a consensus
protocol. It never represents executable commands or external side effects.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Iterable

ACTOR_ID = re.compile(r"^[a-zA-Z0-9_-]{2,80}$")
STATE_KEY = re.compile(r"^[a-zA-Z0-9_.:-]{1,160}$")
MAX_EVENT_BYTES = 32 * 1024
MAX_EVENTS = 20_000


class ReplicatedStateError(ValueError):
    pass


@dataclass(frozen=True)
class StateEvent:
    event_id: str
    actor_id: str
    lamport: int
    key: str
    value: Any
    deleted: bool = False

    def validate(self) -> None:
        if not self.event_id or len(self.event_id) > 128:
            raise ReplicatedStateError("Event id is invalid.")
        if not ACTOR_ID.fullmatch(self.actor_id):
            raise ReplicatedStateError("Actor id is invalid.")
        if not isinstance(self.lamport, int) or self.lamport < 1:
            raise ReplicatedStateError("Lamport clock must be a positive integer.")
        if not isinstance(self.key, str) or not STATE_KEY.fullmatch(self.key):
            raise ReplicatedStateError("State key is invalid.")
        if not isinstance(self.deleted, bool):
            raise ReplicatedStateError("Deletion marker must be boolean.")
        if self.deleted and self.value is not None:
            raise ReplicatedStateError("Tombstone events cannot carry a value.")
        try:
            raw = json.dumps(self.as_dict(), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise ReplicatedStateError("State value must be finite JSON data.") from exc
        if len(raw) > MAX_EVENT_BYTES:
            raise ReplicatedStateError("State event exceeds the size limit.")

    def as_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "actor_id": self.actor_id,
            "lamport": self.lamport,
            "key": self.key,
            "value": self.value,
            "deleted": self.deleted,
        }


def _winner_key(event: StateEvent) -> tuple[int, str, str]:
    # Deterministic tie-break: logical time, actor id, then unique event id.
    return event.lamport, event.actor_id, event.event_id


class ReplicatedState:
    def __init__(self, actor_id: str, events: Iterable[StateEvent] = ()) -> None:
        if not ACTOR_ID.fullmatch(actor_id):
            raise ReplicatedStateError("Local actor id is invalid.")
        self.actor_id = actor_id
        self._events: dict[str, StateEvent] = {}
        self._lamport = 0
        self.merge(events)

    @property
    def lamport(self) -> int:
        return self._lamport

    def set(self, key: str, value: Any, *, event_id: str) -> StateEvent:
        event = StateEvent(event_id, self.actor_id, self._next_clock(), key, value, False)
        self._append(event)
        return event

    def delete(self, key: str, *, event_id: str) -> StateEvent:
        event = StateEvent(event_id, self.actor_id, self._next_clock(), key, None, True)
        self._append(event)
        return event

    def merge(self, incoming: Iterable[StateEvent]) -> int:
        batch = list(incoming)
        if len(batch) > MAX_EVENTS:
            raise ReplicatedStateError("Merge batch exceeds the event limit.")
        pending: dict[str, StateEvent] = {}
        for event in batch:
            if not isinstance(event, StateEvent):
                raise ReplicatedStateError("Only state events may be merged; action messages are forbidden.")
            event.validate()
            existing = self._events.get(event.event_id) or pending.get(event.event_id)
            if existing and existing != event:
                raise ReplicatedStateError("Conflicting payload for an existing event id.")
            if not existing:
                pending[event.event_id] = event
        if len(self._events) + len(pending) > MAX_EVENTS:
            raise ReplicatedStateError("Replicated event history is full; compact a verified snapshot first.")
        self._events.update(pending)
        if pending:
            self._lamport = max(self._lamport, *(event.lamport for event in pending.values()))
        return len(pending)

    def snapshot(self) -> dict[str, Any]:
        winners: dict[str, StateEvent] = {}
        for event in self._events.values():
            current = winners.get(event.key)
            if current is None or _winner_key(event) > _winner_key(current):
                winners[event.key] = event
        return {
            key: {"value": event.value, "deleted": event.deleted, "event_id": event.event_id,
                  "actor_id": event.actor_id, "lamport": event.lamport}
            for key, event in sorted(winners.items())
        }

    def visible_state(self) -> dict[str, Any]:
        return {key: row["value"] for key, row in self.snapshot().items() if not row["deleted"]}

    def events(self) -> tuple[StateEvent, ...]:
        return tuple(sorted(self._events.values(), key=lambda item: (item.lamport, item.actor_id, item.event_id)))

    def digest(self) -> str:
        encoded = json.dumps([event.as_dict() for event in self.events()], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def _next_clock(self) -> int:
        self._lamport += 1
        return self._lamport

    def _append(self, event: StateEvent) -> None:
        event.validate()
        if event.event_id in self._events:
            raise ReplicatedStateError("Event id must be unique.")
        self._events[event.event_id] = event
        if len(self._events) > MAX_EVENTS:
            del self._events[event.event_id]
            raise ReplicatedStateError("Replicated event history is full.")
