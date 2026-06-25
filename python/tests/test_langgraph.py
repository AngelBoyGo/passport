import unittest
from unittest import mock

from passport_sdk.exceptions import PassportGateBlockException
from passport_sdk.langgraph import gate_checkpoint, guard_node, with_fault_capture


class GateCheckpointTests(unittest.TestCase):
    def test_raises_when_gate_denies(self):
        client = mock.Mock()
        client.query_gate.return_value = {
            "allow_invocation": False,
            "reason": "SLA_BREACH_THRESHOLD_EXCEEDED",
        }

        with self.assertRaises(PassportGateBlockException) as ctx:
            gate_checkpoint(client, "op_test", "CODE_GENERATION")()

        self.assertEqual(ctx.exception.operator_id, "op_test")
        self.assertEqual(ctx.exception.domain, "CODE_GENERATION")
        self.assertEqual(ctx.exception.reason, "SLA_BREACH_THRESHOLD_EXCEEDED")

    def test_allows_when_gate_passes(self):
        client = mock.Mock()
        client.query_gate.return_value = {
            "allow_invocation": True,
            "reason": "ok",
        }

        gate_checkpoint(client, "op_test", "CODE_GENERATION")()


class GuardNodeTests(unittest.TestCase):
    def test_guard_node_raises_on_deny(self):
        client = mock.Mock()
        client.query_gate.return_value = {
            "allow_invocation": False,
            "reason": "ZERO_TENANCY_REJECT",
        }

        def node(state):
            return state

        wrapped = guard_node(node, client, "op_test", "CODE_GENERATION")

        with self.assertRaises(PassportGateBlockException):
            wrapped({"step": 1})


class WithFaultCaptureTests(unittest.TestCase):
    def test_finalizes_and_reraises(self):
        client = mock.Mock()

        def failing_fn():
            raise RuntimeError("context length overflow: max tokens exceeded")

        with self.assertRaises(RuntimeError) as ctx:
            with_fault_capture(client, "rcpt_fault_1", failing_fn)

        self.assertIn("context length", str(ctx.exception))
        client.finalize_receipt.assert_called_once_with(
            "rcpt_fault_1",
            status="failure_tombstone",
            error_tranche="COMPUTE_TIMEOUT",
            terminal_reason="context length overflow: max tokens exceeded",
        )


if __name__ == "__main__":
    unittest.main()
