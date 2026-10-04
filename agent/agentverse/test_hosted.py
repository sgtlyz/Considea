import asyncio
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from urllib.request import Request, urlopen

from cryptography.fernet import Fernet
from uagents_core.identity import Identity
from uagents_core.models import Model
from uagents_core.contrib.protocols.chat import ChatMessage, TextContent
from uagents_core.utils.messages import generate_message_envelope
from workflow.agents import MockRunner
from workflow.engine import Workflow
from workflow.security import RoomSecurity
from workflow.store import Store, PostgresStore
from .catalog import ROLES
from .gateway import Gateway
from .hosted import HostedACP, WorkflowClient
from .persistence import GatewayStore


class HostedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "state.sqlite3")
        self.workflow = Workflow(self.store, MockRunner())
        self.key = Fernet.generate_key().decode()
        self.workflow.security = RoomSecurity(self.workflow, {"CONCLAVE_SECRET_KEY": self.key})
        self.seeds = {r: "test-not-production-identity-" + r for r in ROLES}

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_acceptance_does_not_wait_for_outbound_delivery(self):
        started, release = threading.Event(), threading.Event()
        def send(**kwargs):
            started.set()
            release.wait(5)
        service = HostedACP(self.workflow, self.seeds, send=send)
        try:
            msg = ChatMessage(content=[TextContent(type="text", text="/help")])
            sender = Identity.from_seed("offline-test-sender", 0)
            target = Identity.from_seed(self.seeds["idea"], 0)
            env = generate_message_envelope(target.address, Model.build_schema_digest(msg), json.loads(msg.model_dump_json()), sender, session_id=uuid4())
            status, body = service.request("POST", "/idea/chat", env.model_dump_json().encode())
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["status"], "accepted")
            self.assertFalse(release.is_set())
            self.assertTrue(started.wait(2))
            status, body = service.request("GET", "/status")
            self.assertEqual(status, 200)
            self.assertEqual(set(json.loads(body)["agents"]), set(ROLES))
        finally:
            release.set()
            service.close()

    def test_real_workflow_join_and_restart_restore_encrypted_identity(self):
        async def run():
            context = {"member_ids": ["a", "b"], "hackathon_context": "OFFLINE TEST", "deadline_at": None, "constraints": []}
            room = self.workflow.create_room(context)
            config = {"workflow_url": "https://unused.example"}
            def gateway():
                return Gateway(config, WorkflowClient(self.workflow), GatewayStore(self.store, self.workflow.security.cipher))
            g = gateway()
            base = {"sender": "signed-a", "session_id": "session-a", "role": "interview"}
            msg = {**base, "msg_id": "join", "text": f'/join {room["room_id"]} {room["invitations"]["a"]}'}
            self.assertIn("Joined as a", (await g.call(msg))["text"])
            await g.close()
            g = gateway()
            try:
                view = json.loads((await g.call({**base, "msg_id": "status", "text": "/status"}))["text"])
                self.assertEqual(view["actor"]["member_id"], "a")
                self.assertIn("Joined as a", (await g.call(msg))["text"])
                with self.store.transaction() as db:
                    stored = db.execute("SELECT data FROM av_sessions").fetchone()["data"]
                    self.assertNotIn("token", stored)
                    self.assertNotIn(room["room_id"], stored)
            finally:
                await g.close()
        asyncio.run(run())

    def test_create_enforces_existing_live_access_code(self):
        async def run():
            self.workflow.runner.mode = "integrated"
            self.workflow.security = RoomSecurity(self.workflow, {"CONCLAVE_SECRET_KEY": self.key, "CONCLAVE_DEMO_ACCESS_CODE": "test-code"})
            client = WorkflowClient(self.workflow)
            body = {"room_context": {"member_ids": ["a"], "hackathon_context": "test", "deadline_at": None, "constraints": []}}
            response = await client.request("POST", "/api/rooms", json=body)
            self.assertEqual(response.status_code, 403)
        asyncio.run(run())

    def test_existing_http_server_serves_both_workflow_and_acp(self):
        from workflow.server import make_server
        replies = []
        service = HostedACP(self.workflow, self.seeds, send=lambda **kwargs: replies.append(kwargs))
        with patch.dict(os.environ, {"CONSIDEA_AGENTVERSE_SEEDS_JSON": json.dumps(self.seeds), "CONCLAVE_SECRET_KEY": self.key}), \
             patch("agent.agentverse.hosted.from_environment", return_value=service):
            server = make_server(self.workflow, "127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(origin + "/api/health", timeout=3) as response:
                self.assertEqual(json.load(response)["status"], "ok")
            with urlopen(origin + "/agentverse/status", timeout=3) as response:
                self.assertEqual(len(json.load(response)["agents"]), 4)
            msg = ChatMessage(content=[TextContent(type="text", text="/help")])
            sender = Identity.from_seed("offline-http-test-sender", 0)
            target = Identity.from_seed(self.seeds["negotiate"], 0)
            env = generate_message_envelope(target.address, Model.build_schema_digest(msg), json.loads(msg.model_dump_json()), sender, session_id=uuid4())
            request = Request(origin + "/agentverse/negotiate/chat", data=env.model_dump_json().encode(), headers={"Content-Type": "application/json"})
            with urlopen(request, timeout=3) as response:
                self.assertEqual(json.load(response)["status"], "accepted")
            for _ in range(50):
                if len(replies) == 2:
                    break
                time.sleep(.02)
            self.assertEqual(len(replies), 2)
            self.assertEqual(replies[-1]["session_id"], env.session)
        finally:
            server.shutdown()
            thread.join(3)
            server.server_close()


@unittest.skipUnless(os.environ.get("CONCLAVE_TEST_POSTGRES_URL"), "Disposable PostgreSQL not configured")
class PostgresGatewayTests(unittest.TestCase):
    def test_encrypted_reservations_and_transfers_survive_restart(self):
        url = os.environ["CONCLAVE_TEST_POSTGRES_URL"]
        schema = "test_" + uuid4().hex
        store = PostgresStore(url, schema)
        cipher = Fernet(Fernet.generate_key())
        try:
            first = GatewayStore(store, cipher)
            self.assertIsNone(first.reserve("session", "message", "digest"))
            first.complete("session", "message", {"token": "private"}, "reply")
            first.transfer("one-use", "idea", {"token": "private"})
            store.close()
            store = PostgresStore(url, schema)
            second = GatewayStore(store, cipher)
            self.assertEqual(second.reserve("session", "message", "digest"), "reply")
            self.assertEqual(second.session("session"), {"token": "private"})
            self.assertEqual(second.resume("one-use", "idea"), {"token": "private"})
            with self.assertRaises(ValueError):
                second.resume("one-use", "idea")
        finally:
            store.close()
            import psycopg
            assert schema.startswith("test_") and len(schema) == 37
            with psycopg.connect(url) as db:
                db.execute(f'DROP SCHEMA "{schema}" CASCADE')
