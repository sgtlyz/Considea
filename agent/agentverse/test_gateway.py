import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4
import httpx
from fastapi.testclient import TestClient
from uagents_core.identity import Identity
from uagents_core.models import Model
from uagents_core.contrib.protocols.chat import ChatMessage, ChatAcknowledgement, TextContent
from uagents_core.utils.messages import generate_message_envelope
from .app import create_app
from .gateway import Gateway
from .catalog import ROLES

ROOM = "room-" + "a" * 32


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.requests = []
        def handler(request):
            self.requests.append(request)
            if request.url.path.endswith("/join"):
                return httpx.Response(200, json={"token": "private-token", "member_id": "a"})
            if request.method == "GET":
                return httpx.Response(200, json={"room_id": ROOM, "private": {"answer": "private"}, "final_output": None})
            return httpx.Response(200, json={"accepted": True})
        self.g = Gateway({"workflow_url": "https://workflow.example", "state_file": str(Path(self.temp.name) / "state.db")},
                         httpx.AsyncClient(base_url="https://workflow.example", transport=httpx.MockTransport(handler)))
        self.base = {"role": "interview", "sender": "sender-a", "session_id": "session-a"}

    async def asyncTearDown(self):
        await self.g.close()
        self.temp.cleanup()

    async def call(self, text, **changes):
        return await self.g.call({**self.base, "msg_id": str(uuid4()), "text": text, **changes})

    async def test_duplicate_join_does_not_consume_invitation_twice(self):
        message = {**self.base, "msg_id": "same", "text": f"/join {ROOM} invitation"}
        self.assertEqual(await self.g.call(message), await self.g.call(message))
        self.assertEqual(len(self.requests), 1)
        self.assertNotIn("private-token", (await self.g.call(message))["text"])

    async def test_sender_and_session_isolation(self):
        await self.call(f"/join {ROOM} invitation")
        for changes in ({"sender": "other"}, {"session_id": "other"}):
            self.assertIn("Join your team first", (await self.call("/status", **changes))["text"])
        self.assertEqual(len(self.requests), 1)

    async def test_cross_role_transfer_is_single_use_and_role_bound(self):
        await self.call(f"/join {ROOM} invitation")
        transfer = (await self.call("/handoff idea"))["text"].split("/resume ")[1].split(".")[0]
        self.assertIn("not accepted", (await self.call("/resume " + transfer, role="evaluator"))["text"])
        self.assertIn("Connected", (await self.call("/resume " + transfer, role="idea"))["text"])
        self.assertIn("not accepted", (await self.call("/resume " + transfer, role="idea", session_id="new"))["text"])
        self.assertNotIn("private", (await self.call("/status", role="idea"))["text"])

    async def test_no_fabricated_approval_and_no_cross_role_event(self):
        await self.call(f"/join {ROOM} invitation")
        await self.call("yes sounds good")
        await self.call('/event ' + json.dumps({"room_id": ROOM, "type": "candidate.review"}))
        self.assertEqual(len(self.requests), 1)

    async def test_event_keeps_explicit_revision_and_is_idempotent(self):
        await self.call(f"/join {ROOM} invitation")
        event = {"room_id": ROOM, "type": "profile.approve", "expected_revision": 4, "payload": {"draft_ref": {"id": "draft", "version": 2}}}
        msg = {**self.base, "msg_id": "approve", "text": "/event " + json.dumps(event)}
        await self.g.call(msg)
        await self.g.call(msg)
        sent = json.loads(self.requests[-1].content)
        self.assertEqual(sent["expected_revision"], 4)
        self.assertEqual(sent["payload"], event["payload"])
        self.assertEqual(len(self.requests), 2)

    async def test_create_disabled_does_not_contact_paid_backend(self):
        self.assertIn("disabled", (await self.call('/create {}'))["text"])
        self.assertEqual(self.requests, [])

    async def test_uncertain_message_is_never_replayed(self):
        def fail(request):
            self.requests.append(request)
            raise httpx.ReadTimeout("private provider details")
        await self.g.client.aclose()
        self.g.client = httpx.AsyncClient(base_url="https://workflow.example", transport=httpx.MockTransport(fail))
        message = {**self.base, "msg_id": "uncertain", "text": f"/join {ROOM} invitation"}
        result = await self.g.call(message)
        self.assertNotIn("private provider", result["text"])
        self.assertEqual(result, await self.g.call(message))
        self.assertEqual(len(self.requests), 1)


class TransportTests(unittest.TestCase):
    def test_each_identity_is_verified_and_ack_preserves_session(self):
        class Stub:
            async def call(self, message):
                return {"text": "OFFLINE TRANSPORT TEST"}
            async def close(self): pass
        config = {"seeds": {r: "offline-test-only-" + r for r in ROLES}, "workflow_url": "https://workflow.example"}
        sender = Identity.from_seed("offline-test-only-sender", 0)
        sent = []
        with TestClient(create_app(config, Stub(), lambda **kwargs: sent.append(kwargs))) as client:
            for role in ROLES:
                identity = Identity.from_seed(config["seeds"][role], 0)
                msg = ChatMessage(content=[TextContent(type="text", text="/help")])
                env = generate_message_envelope(identity.address, Model.build_schema_digest(msg), json.loads(msg.model_dump_json()), sender, session_id=uuid4())
                self.assertEqual(client.post(f"/{role}/chat", json=env.model_dump(mode="json")).status_code, 200)
                self.assertIsInstance(sent[-2]["msg"], ChatAcknowledgement)
                self.assertEqual(sent[-1]["session_id"], env.session)
                env.signature = None
                self.assertEqual(client.post(f"/{role}/chat", json=env.model_dump(mode="json")).status_code, 401)
