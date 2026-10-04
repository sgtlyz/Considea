"""The live workflow must dispatch Negotiator to the model, not its rule baseline."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from workflow.integration import IntegratedRunner, IntegrationError

PAIR = json.loads((Path(__file__).resolve().parents[2] /
    "agent/interfaces/fixtures/negotiate-difference.json").read_text(encoding="utf-8"))


class Bridge:
    def __init__(self):
        self.messages = []

    def call(self, message):
        self.messages.append(copy.deepcopy(message))
        return copy.deepcopy(PAIR["response"])

    def close(self):
        pass


class NegotiatorIntegrationTests(unittest.TestCase):
    def test_live_dispatch_uses_private_room_credentials_and_no_rule_engine(self):
        bridge = Bridge()
        runner = IntegratedRunner(bridge=bridge)
        runner.credentials_for = lambda room: {"DEEPSEEK_API_KEY": "test-room-key-" + room}
        request = copy.deepcopy(PAIR["request"])
        with patch("agent.negotiate.handle_request", side_effect=AssertionError("Live must not call rules")):
            response = runner.run_task(request, {"attempt": 1})
        message = bridge.messages[0]
        self.assertEqual(message["action"], "agent")
        self.assertEqual(message["request"]["operation"], "negotiate.detect")
        self.assertEqual(message["credentials"]["DEEPSEEK_API_KEY"], "test-room-key-" + request["room_id"])
        self.assertNotIn("offline_response", message)
        self.assertNotIn("test-room-key", json.dumps(request))
        self.assertNotIn("test-room-key", json.dumps(response))
        self.assertEqual(runner.description["negotiator"], "teammate-llm")

    def test_offline_uses_a_labelled_model_fixture_through_the_same_bridge(self):
        bridge = Bridge()
        runner = IntegratedRunner(offline=True, bridge=bridge)
        runner.credentials_for = lambda room: self.fail("Offline must not load keys")
        runner.run_task(copy.deepcopy(PAIR["request"]), {"attempt": 1})
        self.assertIsNone(bridge.messages[0]["credentials"])
        self.assertIn("offline_response", bridge.messages[0])
        self.assertEqual(runner.description["model"], "fixture")

    def test_bridge_failure_is_not_converted_to_a_successful_rule_result(self):
        bridge = Bridge()
        bridge.call = lambda message: (_ for _ in ()).throw(IntegrationError("BRIDGE_TIMEOUT"))
        with patch("agent.negotiate.handle_request", side_effect=AssertionError("No fallback")):
            with self.assertRaises(IntegrationError):
                IntegratedRunner(bridge=bridge).run_task(copy.deepcopy(PAIR["request"]), {"attempt": 1})
