import asyncio
import json
import tempfile
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from uagents_core.identity import Identity
from uagents_core.models import Model
from uagents_core.contrib.protocols.chat import ChatMessage, ChatAcknowledgement, TextContent
from uagents_core.utils.messages import generate_message_envelope
from app import create_app
from bridge import NodeBridge


class FakeBridge:
    def __init__(self): self.calls = []
    async def call(self, message):
        self.calls.append(message)
        return {"ok": True, "text": "OFFLINE TEST RESULT"}
    async def close(self): pass


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.config = {"seed": "offline-test-server-not-a-production-seed", "state_dir": tempfile.mkdtemp()}
        self.target = Identity.from_seed(self.config["seed"], 0)
        self.sender = Identity.from_seed("offline-test-sender-not-production", 0)
        self.bridge = FakeBridge()
        self.sent = []
        self.client = TestClient(create_app(self.config, bridge=self.bridge, send=lambda **kwargs: self.sent.append(kwargs)))

    def envelope(self, msg):
        return generate_message_envelope(self.target.address, Model.build_schema_digest(msg), json.loads(msg.model_dump_json()),
                                         self.sender, session_id=uuid4())

    def test_ack_then_reply_preserves_signed_session(self):
        msg = ChatMessage(content=[TextContent(type="text", text="start")])
        env = self.envelope(msg)
        r = self.client.post('/chat', json=env.model_dump(mode='json'))
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(self.sent[0]['msg'], ChatAcknowledgement)
        self.assertIsInstance(self.sent[1]['msg'], ChatMessage)
        self.assertTrue(all(x['session_id'] == env.session for x in self.sent))
        self.assertEqual(self.bridge.calls[0]['sender'], self.sender.address)

    def test_wrong_signature_or_target_never_reaches_workflow(self):
        for change in ['signature', 'target']:
            env = self.envelope(ChatMessage(content=[TextContent(type='text', text='private')]))
            setattr(env, change, None if change == 'signature' else self.sender.address)
            self.assertEqual(self.client.post('/chat', json=env.model_dump(mode='json')).status_code, 401)
        self.assertEqual(self.bridge.calls, [])

    def test_ack_does_not_trigger_reply_loop(self):
        env = self.envelope(ChatAcknowledgement(acknowledged_msg_id=uuid4()))
        self.assertEqual(self.client.post('/chat', json=env.model_dump(mode='json')).status_code, 200)
        self.assertEqual(self.sent, [])

    def test_asi_routing_mention_is_removed_before_command_dispatch(self):
        for original, expected in [(f'@{self.target.address}  /help', '/help'),
                                   (f'@{self.sender.address} /help', f'@{self.sender.address} /help')]:
            env = self.envelope(ChatMessage(content=[TextContent(type='text', text=original)]))
            self.assertEqual(self.client.post('/chat', json=env.model_dump(mode='json')).status_code, 200)
            self.assertEqual(self.bridge.calls[-1]['text'], expected)

    def test_python_node_bridge_runs_real_offline_profile_flow(self):
        async def run():
            bridge = NodeBridge(state_dir=tempfile.mkdtemp())
            try:
                base = {'sender': 'offline', 'session_id': str(uuid4())}
                result = await bridge.call({**base, 'msg_id': str(uuid4()), 'text': 'start'})
                self.assertTrue(result['ok'])
                result = await bridge.call({**base, 'msg_id': str(uuid4()), 'text': 'OFFLINE SAMPLE: I build frontend applications.'})
                self.assertTrue(result['ok']); self.assertIn('v1', result['text'])
                result = await bridge.call({**base, 'msg_id': str(uuid4()), 'text': '/finish'})
                self.assertIn('/approve', result['text'])
            finally:
                await bridge.close()
        asyncio.run(run())


if __name__ == '__main__': unittest.main()
