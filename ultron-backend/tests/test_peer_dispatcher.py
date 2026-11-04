import unittest

from ultron_backend.runtime.peer_protocol import PeerRegistry, sign_peer_message
from ultron_backend.runtime.peer_dispatcher import PeerDispatcher, PeerDispatchError
from ultron_backend.runtime.replicated_state import ReplicatedState


class PeerDispatcherTests(unittest.TestCase):
    def setUp(self):
        self.key = b"p" * 32
        self.registry = PeerRegistry()
        self.registry.pair("node-a", "ws://10.0.0.2:9000", self.key, {"health.ping", "memory.merge"}, user_consented=True)
        self.state = ReplicatedState("node-b")
        self.dispatcher = PeerDispatcher("node-b", self.registry, self.state)

    def envelope(self, method, payload, message_id):
        return sign_peer_message(self.key, "node-a", method, payload, message_id=message_id, issued_at=1000)

    def test_health_ping_returns_state_telemetry(self):
        result = self.dispatcher.handle(self.envelope("health.ping", {}, "ping"), now=1000)
        self.assertEqual(result["method"], "health.pong")
        self.assertEqual(result["node_id"], "node-b")

    def test_memory_merge_only_changes_replicated_state(self):
        event = {"event_id": "remote-1", "actor_id": "node-a", "lamport": 1,
                 "key": "memory.preference", "value": "local-first", "deleted": False}
        result = self.dispatcher.handle(self.envelope("memory.merge", {"events": [event]}, "merge"), now=1000)
        self.assertEqual(result["accepted_events"], 1)
        self.assertEqual(self.state.visible_state(), {"memory.preference": "local-first"})

    def test_extra_payload_fields_and_remote_actions_are_rejected(self):
        with self.assertRaises(PeerDispatchError):
            self.dispatcher.handle(self.envelope("health.ping", {"command": "run"}, "bad-ping"), now=1000)
        with self.assertRaises(PeerDispatchError):
            self.dispatcher.handle(self.envelope("memory.merge", {"events": [], "execute": "shell"}, "bad-merge"), now=1000)

    def test_invalid_event_does_not_mutate_state(self):
        event = {"event_id": "bad", "actor_id": "node-a", "lamport": 1,
                 "key": "../secrets", "value": "x", "deleted": False}
        with self.assertRaises(PeerDispatchError):
            self.dispatcher.handle(self.envelope("memory.merge", {"events": [event]}, "invalid-event"), now=1000)
        self.assertEqual(self.state.visible_state(), {})


if __name__ == "__main__":
    unittest.main()
