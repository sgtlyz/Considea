import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch
from cryptography.fernet import Fernet
from workflow.agents import MockRunner
from workflow.engine import Workflow
from workflow.server import make_server
from workflow.store import Store


class ProviderApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workflow = Workflow(Store(Path(self.temp.name) / "test.sqlite3"), MockRunner())
        with patch.dict("os.environ", {"CONCLAVE_SECRET_KEY": Fernet.generate_key().decode(), "OPENAI_MODEL": "gpt-4.1-mini"}):
            self.server = make_server(self.workflow, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}/api"
        self.body = {"room_context": {"member_ids": ["alice", "bob"], "hackathon_context": "Provider test",
                                    "deadline_at": None, "constraints": []},
                     "config": {"search_enabled": True},
                     "credentials": {"provider": "openai", "openai_api_key": "sk-http-private-openai",
                                     "tavily_api_key": "http-private-tavily", "model": "gpt-4.1-mini"}}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def post(self, body):
        return urlopen(Request(self.base + "/rooms", data=json.dumps(body).encode(),
                               headers={"Content-Type": "application/json"}), timeout=5)

    def test_capabilities_expose_provider_choices_and_default_model_without_keys(self):
        with urlopen(self.base + "/capabilities", timeout=5) as response:
            data = json.load(response)
        self.assertEqual(data["model_providers"], ["deepseek", "openai"])
        self.assertEqual(data["openai_model"], "gpt-4.1-mini")
        self.assertIs(data["cumulative_request_limits"], False)
        self.assertNotIn("api_key", json.dumps(data))

    def test_legacy_cumulative_quotas_do_not_block_room_creation_or_admin_controls(self):
        self.workflow.runner.mode = "integrated"
        self.workflow.security.live = True
        with self.workflow.store.transaction() as db:
            period = int(time.time()) // 86400
            db.execute("INSERT INTO usage_limits(scope,period,used,expires_at) VALUES(?,?,?,?)",
                       ("create-global", period, 100001, (period+2)*86400))
        self.body["config"]["max_agent_calls"] = 1
        with self.post(self.body) as response:
            room = json.load(response)
        path = self.base + "/rooms/" + room["room_id"]
        with urlopen(Request(path, headers={"Authorization": "Bearer " + room["admin_token"]}), timeout=5) as response:
            view = json.load(response)
        self.assertIsNone(view["config"]["max_agent_calls"])
        self.assertIsNone(view["access"]["room_call_limit"])
        with urlopen(Request(path + "/budget", data=json.dumps({"max_agent_calls": 100001}).encode(),
                             headers={"Content-Type": "application/json",
                                      "Authorization": "Bearer " + room["admin_token"]}), timeout=5) as response:
            self.assertEqual(json.load(response), {"max_agent_calls": None})

    def test_openai_room_creation_still_requires_tavily_when_search_is_enabled(self):
        without_tavily = json.loads(json.dumps(self.body))
        without_tavily["credentials"].pop("tavily_api_key")
        with self.assertRaises(HTTPError) as caught:
            self.post(without_tavily)
        self.assertEqual(caught.exception.code, 400)
        with self.post(self.body) as response:
            data = json.load(response)
        self.assertIn("room_id", data)
        self.assertNotIn("http-private", json.dumps(data))


if __name__ == "__main__":
    unittest.main()
