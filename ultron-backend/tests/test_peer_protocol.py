import unittest

from ultron_backend.runtime.peer_protocol import (
    PeerProtocolError, PeerRegistry, sign_peer_message, validate_peer_endpoint,
)


class PeerProtocolTests(unittest.TestCase):
    def setUp(self):
        self.shared_key = b"k" * 32
        self.registry = PeerRegistry()
        self.registry.pair("node-a", "ws://192.168.1.20:8765", self.shared_key, {"memory.merge", "health.ping"}, user_consented=True, requests_per_minute=2)

    def envelope(self, **overrides):
        message_id = overrides.pop("message_id", "message-1")
        body = sign_peer_message(self.shared_key, "node-a", "memory.merge", {"key": "value"}, message_id=message_id, issued_at=1000)
        body.update(overrides)
        return body

    def test_valid_signed_message_is_verified(self):
        message = self.registry.verify(self.envelope(), now=1000)
        self.assertEqual(message.method, "memory.merge")
        self.assertEqual(message.payload, {"key": "value"})

    def test_replay_is_rejected(self):
        self.registry.verify(self.envelope(), now=1000)
        with self.assertRaises(PeerProtocolError):
            self.registry.verify(self.envelope(message_id="message-1"), now=1000)

    def test_signature_tampering_is_rejected(self):
        envelope = self.envelope()
        envelope["payload"] = {"key": "tampered"}
        with self.assertRaises(PeerProtocolError):
            self.registry.verify(envelope, now=1000)

    def test_unapproved_method_and_clock_skew_are_rejected(self):
        envelope = sign_peer_message(self.shared_key, "node-a", "tools.execute", {}, message_id="x", issued_at=1000)
        with self.assertRaises(PeerProtocolError):
            self.registry.verify(envelope, now=1000)
        with self.assertRaises(PeerProtocolError):
            self.registry.verify(self.envelope(message_id="late"), now=2000)

    def test_rate_limit_is_enforced(self):
        self.registry.verify(self.envelope(message_id="one"), now=1000)
        self.registry.verify(self.envelope(message_id="two"), now=1001)
        with self.assertRaises(PeerProtocolError):
            self.registry.verify(self.envelope(message_id="three"), now=1002)

    def test_pairing_requires_consent_and_endpoint_is_restricted(self):
        with self.assertRaises(PeerProtocolError):
            self.registry.pair("node-b", "wss://peer.example/rpc", self.shared_key, {"health.ping"}, user_consented=False)
        for endpoint in ("http://192.168.1.2", "ws://example.com", "ws://user:pass@localhost:4"):
            with self.assertRaises(PeerProtocolError):
                validate_peer_endpoint(endpoint)

    def test_revoke_invalidates_peer(self):
        self.registry.revoke("node-a")
        with self.assertRaises(PeerProtocolError):
            self.registry.verify(self.envelope(), now=1000)


if __name__ == "__main__":
    unittest.main()
