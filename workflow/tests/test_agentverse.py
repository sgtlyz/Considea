"""ACP must preserve the website's identity, privacy, idempotency and human gates."""
import json
import queue
import re
import tempfile
import time
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from urllib.request import Request, urlopen

from cryptography.fernet import Fernet
from uagents_core.contrib.protocols.chat import ChatMessage, ChatAcknowledgement, TextContent
from uagents_core.identity import Identity
from uagents_core.models import Model
from uagents_core.utils.messages import generate_message_envelope

from workflow.agentverse import Agentverse
from workflow.agentverse_chat import ChatWorkflow, tag
from workflow.agents import MockRunner
from workflow.engine import Workflow, WorkflowError
from workflow.integration import IntegratedRunner
from workflow.register_agentverse import check_status
from workflow.security import RoomSecurity
from workflow.server import make_server
from workflow.store import Store, digest
from workflow.tests.test_privacy import PersonalRunner, QUESTION


class ChatTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = Workflow(Store(Path(self.temp.name) / "chat.db"), MockRunner())
        self.security = RoomSecurity(self.engine, {"CONCLAVE_SECRET_KEY": Fernet.generate_key().decode()})
        self.engine.security = self.security
        self.chat = ChatWorkflow(self.engine, self.security)
        self.join_members()

    def join_members(self):
        result = self.say("alice", "/create code | alice,bob | Hackathon collaboration | 24")
        command = re.search(r"bob: (/join \S+ \S+)", result)[1]
        self.say("bob", command)

    def tearDown(self):
        self.engine.store.close()
        self.temp.cleanup()

    def say(self, member, message, role="interview"):
        return self.chat.handle(role, member, str(uuid4()), message)

    def view(self, member="alice"):
        return self.chat.view(self.chat.binding(member))

    def drain(self):
        for _ in range(100):
            if not self.engine.run_once():
                return
        self.fail("Model work did not stop at a human gate")

    def interviews(self):
        for _ in range(20):
            self.drain()
            if self.view()["phase"] != "interviewing":
                return
            for member in ("alice", "bob"):
                self.say(member, "/status")
                private = self.view(member)["private"]
                if private["stage"] == "awaiting_answers":
                    answers = " | ".join("PRIVATE-" + member for _ in private["question_batch"]["questions"])
                    result = self.say(member, "/answer " + answers)
                    self.assertIn("saved", result)
                elif private["stage"] == "awaiting_profile_approval":
                    self.say(member, "/edit 1 Approved goal " + member)
                    result = self.say(member, "/approve " + tag(private["draft"]["draft_ref"]))
                    self.assertIn("saved", result)
        self.fail("Interviews did not finish")

    def review_gate(self):
        for n in range(1, 5):
            self.interviews()
            self.assertEqual(self.view()["discussion_round"], n)
            self.assertFalse(self.view()["candidates"])
            self.assertNotIn("Your action was saved", self.say("alice", "/vote converge"))
            for member in ("alice", "bob"):
                self.say(member, "/status")
                self.assertIn("saved", self.say(member, "/difference Ready if we keep scope small", "negotiate"))
            if n < 4:
                self.say("alice", "/status")
                self.assertIn("saved", self.say("alice", "/vote diverge", "negotiate"))
        self.assertEqual(self.view()["phase"], "awaiting_convergence_decision")
        for member in ("alice", "bob"):
            self.say(member, "/status")
            self.assertIn("saved", self.say(member, "/vote converge", "negotiate"))
        self.drain()
        self.assertEqual(self.view()["phase"], "awaiting_review")

    def test_complete_workflow_and_revision_use_same_agents_and_human_gates(self):
        self.review_gate()
        cid = next(iter(self.view()["candidates"]))
        old = tag(self.view()["candidates"][cid]["candidate_ref"])
        for member in ("alice", "bob"):
            self.say(member, "/status", "evaluator")
            self.assertIn("saved", self.say(member, "/revise " + old + " | Only text cards", "idea"))
        self.drain()
        new = tag(self.view()["candidates"][cid]["candidate_ref"])
        self.assertNotEqual(old, new)
        self.say("alice", "/status")
        self.assertNotIn("Your action was saved", self.say("alice", "/accept " + old))
        for member in ("alice", "bob"):
            self.say(member, "/status")
            result = self.say(member, "/accept " + new, "evaluator")
            self.assertIn("saved", result)
        self.assertEqual(self.view()["phase"], "completed")
        self.assertIn("agreed project brief", result)
        self.assertNotIn("PRIVATE-", result)
        with self.engine.store.transaction() as db:
            operations = {row[0] for row in db.execute("SELECT operation FROM tasks")}
        self.assertTrue({"interview.turn", "interview.summarize", "negotiate.detect", "idea.generate", "idea.revise", "evaluator.evaluate"} <= operations)

    def test_personal_difference_hidden_from_other_members(self):
        self.engine.runner = PersonalRunner()
        self.interviews()
        self.assertIn(QUESTION, self.say("alice", "/status", "negotiate"))
        other = self.say("bob", "/status", "negotiate")
        self.assertNotIn(QUESTION, other)
        self.assertNotIn("PRIVATE-alice", other)
        self.assertIn("Waiting for the affected", other)
        self.assertNotIn("Your action was saved", self.say("bob", "/difference impersonating"))

    def test_changed_question_requires_refresh_before_applying_answer(self):
        self.drain()
        self.say("alice", "/status")
        original = self.chat.binding("alice")
        self.say("alice", "/answer First response")
        self.drain()
        self.chat.save("alice", original)  # Another web/ASI session advanced the questions.
        result = self.say("alice", "/answer An answer to the old question")
        self.assertIn("changed since", result)
        messages = json.dumps(self.view()["private"]["messages"])
        self.assertNotIn("An answer to the old", messages)

    def test_new_sender_or_session_does_not_inherit_membership(self):
        self.drain()
        self.say("alice", "/status")
        self.say("alice", "/answer PRIVATE-ALICE-ONLY")
        self.assertNotIn("PRIVATE-ALICE-ONLY", self.say("different-session", "/status"))
        self.assertIsNone(self.chat.binding("different-session"))

    def test_binary_difference_choices(self):
        class BinaryRunner(MockRunner):
            def __call__(self, request):
                result = super().__call__(request)
                if request["operation"] == "negotiate.detect":
                    result["data"]["difference"].update(answer_type="binary", options=[{"key":"a","label":"Web app"},{"key":"b","label":"Mobile app"}])
                return result
        self.engine.runner = BinaryRunner()
        self.interviews()
        self.assertIn("a: Web app", self.say("alice", "/status"))
        self.assertIn("Choose one", self.say("alice", "/difference Web app"))
        self.assertIn("saved", self.say("alice", "/choose a | Comfortable with web development"))

    def test_real_teammate_agent_services_with_model_fixtures(self):
        runner = IntegratedRunner(offline=True)
        self.addCleanup(runner.close)
        self.engine = Workflow(Store(Path(self.temp.name) / "integrated.db"), runner)
        self.security = RoomSecurity(self.engine, {"CONCLAVE_SECRET_KEY": Fernet.generate_key().decode(),
                                                  "CONCLAVE_DEMO_ACCESS_CODE": "code"})
        self.engine.security = self.security
        self.chat = ChatWorkflow(self.engine, self.security)
        self.join_members()
        self.test_complete_workflow_and_revision_use_same_agents_and_human_gates()


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = Workflow(Store(Path(self.temp.name) / "transport.db"), MockRunner())
        self.security = RoomSecurity(self.engine, {"CONCLAVE_SECRET_KEY": Fernet.generate_key().decode()})
        self.sent = queue.Queue()
        self.adapter = Agentverse(self.engine, self.security, {"interview": "test-only-agentverse-server-seed-do-not-deploy"}, send=lambda **kw: self.sent.put(kw))
        self.identity = self.adapter.identities["interview"]
        self.sender = Identity.from_seed("test-only-agentverse-sender-not-production", 0)
        self.session = uuid4()

    def tearDown(self):
        self.adapter.close()
        self.engine.store.close()
        self.temp.cleanup()

    def envelope(self, text=None, msg=None):
        msg = msg or ChatMessage(content=[TextContent(type="text", text=text)])
        return generate_message_envelope(self.identity.address, Model.build_schema_digest(msg), json.loads(msg.model_dump_json()), self.sender, session_id=self.session)

    def receive(self, env):
        result = self.adapter.receive("interview", env.model_dump(mode="json"))
        self.assertEqual(result["status"], "accepted")
        ack, reply = self.sent.get(timeout=5), self.sent.get(timeout=5)
        self.assertIsInstance(ack["msg"], ChatAcknowledgement)
        self.assertIsInstance(reply["msg"], ChatMessage)
        for delivery in (ack, reply):
            self.assertEqual(delivery["destination"], self.sender.address)
            self.assertEqual(delivery["session_id"], self.session)
            self.assertFalse(delivery["track_interaction"])
        return reply["msg"].content[0].text

    def test_signed_repeated_create_is_idempotent_and_persistent(self):
        env = self.envelope("/create code | alice | Private context | 24")
        first = self.receive(env)
        self.assertIn("Created room", first)
        self.assertEqual(first, self.receive(env))
        with self.engine.store.transaction() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM rooms").fetchone()[0], 1)
            sessions = db.execute("SELECT data FROM agentverse_sessions").fetchone()[0]
            reply = db.execute("SELECT reply FROM agentverse_receipts").fetchone()[0]
            self.assertNotIn("token", sessions)
            self.assertNotIn("/recover", reply)
        key = digest([self.sender.address, str(self.session)])
        self.assertIsNotNone(ChatWorkflow(self.engine, self.security).binding(key))

    def test_invalid_signature_target_and_expiry_rejected(self):
        for field, value in (("signature", None), ("target", self.sender.address), ("expires", int(time.time()) - 1)):
            env = self.envelope("/help")
            setattr(env, field, value)
            if field == "expires": env.sign(self.sender)
            with self.assertRaises(WorkflowError) as error:
                self.adapter.receive("interview", env.model_dump(mode="json"))
            self.assertEqual(error.exception.status, 401)
        self.assertTrue(self.sent.empty())

    def test_ack_ignored_old_message_and_changed_replay_rejected(self):
        env = self.envelope(msg=ChatAcknowledgement(acknowledged_msg_id=uuid4()))
        self.assertEqual(self.adapter.receive("interview", env.model_dump(mode="json"))["status"], "acknowledged")
        self.assertTrue(self.sent.empty())
        old = ChatMessage(timestamp=datetime.now(timezone.utc) - timedelta(days=2), content=[TextContent(type="text", text="/help")])
        with self.assertRaises(WorkflowError):
            self.adapter.receive("interview", self.envelope(msg=old).model_dump(mode="json"))
        first = ChatMessage(content=[TextContent(type="text", text="/help")])
        self.receive(self.envelope(msg=first))
        first.content[0].text = "/create code | alice | replay attack | 24"
        self.assertIn("different content", self.receive(self.envelope(msg=first)))
        with self.engine.store.transaction() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM rooms").fetchone()[0], 0)

    def test_unconfirmed_receipt_is_never_reexecuted(self):
        key, message = "session-key", "message-key"
        command = "/create code | alice | crash recovery | 24"
        with self.engine.store.transaction() as db:
            db.execute("INSERT INTO agentverse_receipts VALUES(?,?,NULL,?)", (digest(["interview",key,message]),digest(command),time.time()))
        self.assertIn("will not be repeated", self.adapter.run_once("interview", key, message, command))
        with self.engine.store.transaction() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM rooms").fetchone()[0], 0)

    def test_recovery_revokes_access_to_cached_private_reply(self):
        env = self.envelope("/create code | alice | Private context | 24")
        first = self.receive(env)
        room, member, code = re.search(r"/recover (\S+) (\S+) (\S+)", first).groups()
        self.engine.recover(room, "member", member, code)
        reply = self.receive(env)
        self.assertIn("no longer valid", reply)
        self.assertNotIn("/recover", reply)
        self.assertNotIn(code, reply)

    def test_http_routes_to_configured_adapter_without_exposing_seeds(self):
        import threading
        with patch("workflow.server.Agentverse.configured", return_value=self.adapter):
            server = make_server(self.engine, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            with urlopen(base + "/agentverse/status") as response:
                status = json.load(response)
            self.assertEqual(status["agents"]["interview"]["address"], self.identity.address)
            self.assertNotIn("test-only", json.dumps(status))
            env = self.envelope("/help")
            request = Request(base + "/agentverse/interview/chat", data=env.model_dump_json().encode(), headers={"Content-Type": "application/json"})
            with urlopen(request) as response:
                self.assertEqual(json.load(response)["status"], "accepted")
            self.sent.get(timeout=5)
            self.assertIn("Considea Interview", self.sent.get(timeout=5)["msg"].content[0].text)
        finally:
            server.shutdown()
            thread.join(timeout=3)
            server.server_close()

    def test_only_own_routing_mention_is_stripped(self):
        reply = self.receive(self.envelope(f"@{self.identity.address} /help"))
        self.assertIn("Considea Interview", reply)

    def test_registration_rejects_mock_or_wrong_identity(self):
        seeds = {"interview": "test-only-agentverse-server-seed-do-not-deploy"}
        status = self.adapter.status()
        with self.assertRaises(ValueError):
            check_status("https://example.com", seeds, ["interview"], status)
        status.update(mode="integrated", offline=False)
        check_status("https://example.com", seeds, ["interview"], status)
        status["agents"]["interview"]["address"] = self.sender.address
        with self.assertRaises(ValueError):
            check_status("https://example.com", seeds, ["interview"], status)


if __name__ == "__main__":
    unittest.main()
