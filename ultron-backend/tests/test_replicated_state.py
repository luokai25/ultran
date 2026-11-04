import unittest

from ultron_backend.runtime.replicated_state import ReplicatedState, ReplicatedStateError, StateEvent


class ReplicatedStateTests(unittest.TestCase):
    def test_concurrent_merges_converge_independent_of_arrival_order(self):
        left = ReplicatedState("node-a")
        right = ReplicatedState("node-b")
        a = left.set("profile.theme", "dark", event_id="a1")
        b = right.set("profile.theme", "light", event_id="b1")
        left.merge([b])
        right.merge([a])
        self.assertEqual(left.visible_state(), right.visible_state())
        self.assertEqual(left.digest(), right.digest())

    def test_tombstones_converge_and_prevent_resurrection(self):
        node_a = ReplicatedState("node-a")
        node_b = ReplicatedState("node-b")
        old = node_a.set("memory.fact", "old", event_id="old")
        node_b.merge([old])
        tombstone = node_b.delete("memory.fact", event_id="deleted")
        node_a.merge([tombstone])
        self.assertNotIn("memory.fact", node_a.visible_state())
        self.assertEqual(node_a.snapshot(), node_b.snapshot())

    def test_duplicate_events_are_idempotent_and_conflicts_rejected(self):
        node = ReplicatedState("node-a")
        event = StateEvent("event-1", "node-b", 1, "key", "value")
        self.assertEqual(node.merge([event, event]), 1)
        self.assertEqual(node.merge([event]), 0)
        with self.assertRaises(ReplicatedStateError):
            node.merge([StateEvent("event-1", "node-b", 1, "key", "tampered")])

    def test_action_execution_payloads_are_not_state_events(self):
        node = ReplicatedState("node-a")
        with self.assertRaises(ReplicatedStateError):
            node.merge([{"type": "tool.execute", "command": "delete everything"}])

    def test_invalid_keys_non_json_and_nan_are_rejected(self):
        node = ReplicatedState("node-a")
        with self.assertRaises(ReplicatedStateError):
            node.set("../secrets", "x", event_id="bad")
        with self.assertRaises(ReplicatedStateError):
            node.set("state", float("nan"), event_id="nan")

    def test_lamport_clock_advances_after_merge(self):
        node = ReplicatedState("node-a")
        node.merge([StateEvent("remote", "node-b", 12, "key", "v")])
        created = node.set("next", "v", event_id="local")
        self.assertEqual(created.lamport, 13)


if __name__ == "__main__":
    unittest.main()
