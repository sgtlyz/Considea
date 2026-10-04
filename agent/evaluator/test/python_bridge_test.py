import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).parents[1] / 'python_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeResponseTests(unittest.TestCase):
    def test_unicode_separator_inside_a_single_jsonl_response_is_not_a_second_response(self):
        request = {'schema_version': '1.0', 'request_id': 'r', 'room_id': 'room',
                   'operation': 'evaluator.evaluate', 'input_revision': 1}
        response = {**request, 'status': 'ok', 'data': {'excerpt': 'one\u2028two\u2029three'},
                    'warnings': [], 'error': None}
        process = SimpleNamespace(returncode=0, stdout=json.dumps(response, ensure_ascii=False) + '\n')
        with patch.object(bridge.subprocess, 'run', return_value=process):
            self.assertEqual(bridge.run_evaluator(request), response)

    def test_two_actual_jsonl_responses_remain_a_bridge_error(self):
        process = SimpleNamespace(returncode=0, stdout='{}\n{}\n')
        with patch.object(bridge.subprocess, 'run', return_value=process):
            self.assertEqual(bridge.run_evaluator({})['error']['code'], 'BRIDGE_ERROR')


if __name__ == '__main__':
    unittest.main()
