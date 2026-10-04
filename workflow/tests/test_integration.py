"""Real teammate validators/services + actual Pi loop; the model itself is a fixture."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from workflow.tests import test_workflow as base
from workflow.engine import Workflow
from workflow.integration import IntegratedRunner, SharedSync
from workflow.store import Store


class IntegrationTests(unittest.TestCase):
    spacetime_config = None
    view = base.WorkflowTests.view
    send = base.WorkflowTests.send
    vote = base.WorkflowTests.vote
    review = base.WorkflowTests.review
    complete_interviews = base.WorkflowTests.complete_interviews
    reach_convergence_gate = base.WorkflowTests.reach_convergence_gate
    reach_review = base.WorkflowTests.reach_review
    store_transaction = base.WorkflowTests.store_transaction

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "state.sqlite3"
        self.runner = IntegratedRunner(offline=True, spacetime_config=self.spacetime_config)
        self.engine = Workflow(Store(self.path), self.runner, lease_seconds=480)
        self.sync = SharedSync(self.engine.store, self.runner.bridge) if self.spacetime_config else None
        self.context = {"member_ids": ["alice", "bob"], "hackathon_context": "Synthetic integration test",
                        "deadline_at": None, "constraints": []}
        self.created = self.engine.create_room(self.context, {"candidate_count": 2})
        self.room = self.created["room_id"]
        self.tokens = {m: self.engine.join(self.room, invite)["token"] for m, invite in self.created["invitations"].items()}

    def tearDown(self):
        self.runner.close()
        self.temp.cleanup()

    def drain(self, limit=100):
        base.WorkflowTests.drain(self, limit)
        failures = [t for t in self.engine.view(self.created["admin_token"], self.room)["tasks"] if t["status"] == "failed"]
        self.assertEqual(failures, [], "Real teammate services rejected an integration request")
        if self.sync:
            self.assertTrue(self.sync.run_once(), self.sync.last_error)
            self.assertEqual(self.runner.bridge.boards[self.room], self.view()["revision"])

    def answer_difference(self):
        v = self.view()
        d = v["difference"]["content"]
        for member in d["affected_member_ids"]:
            result, _ = self.send(member, "difference.answer", {
                "difference_ref": v["difference"]["difference_ref"],
                "selected_option_key": d["options"][0]["key"] if d["answer_type"] == "binary" else None,
                "text": "A public condition from " + member, "disagrees_with_framing": False})
            self.assertEqual(result["status"], "accepted")

    def test_complete_flow_and_private_memory(self):
        base.WorkflowTests.test_complete_path_requires_real_answers_and_unanimous_accept(self)
        with self.store_transaction() as db:
            snapshot = db.execute("SELECT snapshot FROM shared_outbox WHERE room_id=?", (self.room,)).fetchone()[0]
            self.assertNotIn("PRIVATE-", snapshot)
            for row in db.execute("SELECT request FROM tasks WHERE operation='interview.turn'"):
                req = json.loads(row[0]); self.assertEqual(req["payload"]["contract_version"], "2.1")
        self.assertEqual(self.view()["agent_runtime"]["mem0"], "disabled")

    def test_human_diverge_and_reopened_interview(self):
        self.reach_convergence_gate(); self.vote("alice", "diverge")
        self.complete_interviews(); self.answer_difference()
        self.vote("alice", "converge"); self.vote("bob", "converge"); self.drain()
        cid = next(iter(self.view()["candidates"]))
        self.review("alice", cid, "more_discussion", "Clarify time")
        self.review("bob", cid, "more_discussion", "Clarify hardware")
        self.complete_interviews()
        self.assertEqual(self.view()["discussion_round"], 6)
        with self.store_transaction() as db:
            requests = [json.loads(r[0]) for r in db.execute("SELECT request FROM tasks WHERE operation LIKE 'interview.%'")]
        reopened = [r["payload"] for r in requests if r["payload"]["mode"] == "reopened"]
        self.assertTrue(reopened)
        for p in reopened:
            ctx=p["followup_context"]
            self.assertEqual(ctx["review"]["member_id"], p["member_id"])
            self.assertEqual(ctx["candidate"]["candidate_ref"], ctx["evaluation"]["content"]["candidate_ref"])
            self.assertEqual(ctx["evaluation"]["feasibility"]["verdict"], "unknown")

    def test_minor_revision_and_new_evaluation(self):
        base.WorkflowTests.test_minor_revision_versions_and_reconfirmation(self)

    def test_outbox_recovers_after_sync_failure(self):
        class FailedBridge:
            def call(self, *args, **kwargs):
                from workflow.integration import IntegrationError
                raise IntegrationError("SPACETIME_DISCONNECTED")
        failed=SharedSync(self.engine.store, FailedBridge())
        self.assertFalse(failed.run_once())
        with self.store_transaction() as db:
            row=db.execute("SELECT revision,delivered_revision,snapshot FROM shared_outbox").fetchone()
            self.assertGreater(row[0],row[1])
            snapshot=json.loads(row[2]); self.assertNotIn("private",snapshot)
            self.assertNotIn("messages",json.dumps(snapshot))
        if self.sync:
            self.assertTrue(self.sync.run_once())
            self.assertIsNone(self.sync.last_error)


@unittest.skipUnless(os.environ.get("CONCLAVE_TEST_SPACETIME_CONFIG"), "Set the isolated local SpacetimeDB test config")
class SpacetimeIntegrationTests(IntegrationTests):
    spacetime_config = os.environ.get("CONCLAVE_TEST_SPACETIME_CONFIG")
