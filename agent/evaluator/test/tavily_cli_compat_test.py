import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('compat', Path(__file__).parents[1] / 'tavily_cli_compat.py')
compat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compat)


class SseResponseTests(unittest.TestCase):
    def test_unicode_separators_are_json_content_not_protocol_line_endings(self):
        body = {'results': [{'content': 'one\u2028two\u2029three\u0085four'}]}
        event = json.dumps({'jsonrpc': '2.0', 'id': 1, 'result': {'structuredContent': body}}, ensure_ascii=False)
        self.assertEqual(compat.decode_mcp_response('event: message\r\ndata: ' + event + '\r\n\r\n'), body)

    def test_multiline_sse_data_and_text_wrapped_content(self):
        body = {'results': []}
        text = json.dumps({'result': {'content': [{'type': 'text', 'text': json.dumps(body)}]}}, indent=2)
        event = '\n'.join('data: ' + line for line in text.split('\n'))
        self.assertEqual(compat.decode_mcp_response(': comment\n' + event + '\n\n'), body)

    def test_json_response_and_protocol_failure_without_echoing_server_details(self):
        self.assertEqual(compat.decode_mcp_response('{"result":{"structuredContent":{"results":[]}}}'), {'results': []})
        with self.assertRaisesRegex(ValueError, '^MCP server returned a protocol error$'):
            compat.decode_mcp_response('{"error":{"message":"private server detail"}}')


if __name__ == '__main__':
    unittest.main()
