import json
import tempfile
import threading
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
        self.assertNotIn("api_key", json.dumps(data))

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
