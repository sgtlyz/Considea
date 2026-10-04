"""Security regressions: a personal clarification must not become shared context."""
import copy
import json
from pathlib import Path
import subprocess
import unittest

from workflow import privacy
from workflow.agents import MockRunner
from workflow.integration import SharedSync
from workflow.store import Store, encode
from workflow.tests import test_workflow as base

QUESTION = "PERSONAL-CONFLICT-ONLY-ALICE"
ANSWER = "PERSONAL-ANSWER-ONLY-ALICE"


class PersonalRunner(MockRunner):
    def __call__(self, request):
        result = super().__call__(request)
        if request["operation"] == "negotiate.detect":
            profile = next(p for p in request["payload"]["shared_context"]["profiles"] if p["member_id"] == "alice")
            result["data"]["difference"].update(
                question=QUESTION + ": " + profile["items"][0]["text"],
                affected_member_ids=["alice"], source_ids=[i["source_id"] for i in profile["items"]],
                why_it_matters="One member's conflicting statements need that member's confirmation before they become a team split.")
        return result


class PrivacyTests(unittest.TestCase):
    setUp = base.WorkflowTests.setUp
    tearDown = base.WorkflowTests.tearDown
    view = base.WorkflowTests.view
    send = base.WorkflowTests.send
    drain = base.WorkflowTests.drain
    complete_interviews = base.WorkflowTests.complete_interviews
    vote = base.WorkflowTests.vote

    def prepare(self):
        self.runner = self.engine.runner = PersonalRunner()
        self.complete_interviews()
        self.assertEqual(self.view()["phase"], "awaiting_difference_answers")

    def answer(self):
        return self.send("alice", "difference.answer", {
            "difference_ref": self.view()["difference"]["difference_ref"],
            "selected_option_key": None, "text": ANSWER, "disagrees_with_framing": True,
        })[0]

    def assertPrivate(self, value):
        text = json.dumps(value)
        self.assertNotIn(QUESTION, text)
        self.assertNotIn(ANSWER, text)

    def assertSourcesResolve(self, context):
        sources = {s["source_id"] for s in context["sources"]}
        for profile in context["profiles"]:
            self.assertTrue(all(item["source_id"] in sources for item in profile["items"]))
        for row in context["discussion_history"]:
            for key, ids in row.items():
                if key.endswith("_source_ids"):
                    self.assertTrue(set(ids) <= sources)

    def test_member_admin_and_outbox_cannot_read_or_answer_personal_conflict(self):
        self.prepare()
        owner = self.view()
        self.assertIn(QUESTION, owner["difference"]["content"]["question"])
        self.assertIn("your confirmation", owner["difference"]["content"]["why_it_matters"])
        for token in (self.tokens["bob"], self.created["admin_token"]):
            view = self.engine.view(token, self.room)
            self.assertPrivate(view)
            self.assertNotIn("Approved public goal for alice", json.dumps(view))
            self.assertEqual(view["difference"]["visibility"], "private")
            self.assertEqual(view["difference"]["difference_ref"], owner["difference"]["difference_ref"])
            self.assertSourcesResolve(view["shared_context"])
        result, _ = self.send("bob", "difference.answer", {
            "difference_ref": owner["difference"]["difference_ref"], "selected_option_key": None,
            "text": "Impersonating a confirmation", "disagrees_with_framing": False,
        })
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(self.view()["phase"], "awaiting_difference_answers")
        with self.engine.store.transaction() as db:
            self.assertPrivate(json.loads(db.execute("SELECT snapshot FROM shared_outbox").fetchone()[0]))
            state = Store.load(db, self.room)
            self.assertIn(QUESTION, json.dumps(state))  # Private audit data is preserved.

    def test_followup_is_private_and_real_interview_contract_accepts_both_members(self):
        self.prepare()
        self.assertEqual(self.answer()["status"], "accepted")
        self.assertEqual(self.view()["discussion_round"], 2)
        with self.engine.store.transaction() as db:
            requests = [json.loads(row[0]) for row in db.execute("SELECT request FROM tasks WHERE status='queued'")]
        payloads = {r["payload"]["member_id"]: r["payload"] for r in requests}
        self.assertEqual(payloads["alice"]["mode"], "followup")
        self.assertIn(ANSWER, json.dumps(payloads["alice"]))
        self.assertEqual(payloads["bob"]["mode"], "initial")
        self.assertIsNone(payloads["bob"]["followup_context"])
        self.assertPrivate(payloads["bob"])
        self.assertTrue(payloads["bob"]["messages"])
        self.assertEqual(payloads["bob"]["current_profile"]["member_id"], "bob")
        for p in payloads.values():
            self.assertSourcesResolve(p["shared_context"])
        script = "import fs from 'node:fs'; import {validateTurnInput} from './agent/interview/definition.mjs'; " \
                 "const ps=JSON.parse(fs.readFileSync(0,'utf8')); if (!ps.every(validateTurnInput)) process.exit(1);"
        run = subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(list(payloads.values())),
                             text=True, capture_output=True, cwd=Path(__file__).resolve().parents[2])
        self.assertEqual(run.returncode, 0, run.stderr)
        self.complete_interviews()
        self.assertPrivate(self.view("bob"))
        self.assertIn("Approved public goal for bob", json.dumps(self.view()["shared_context"]))

    def test_round_four_still_requires_personal_answer_then_every_members_vote(self):
        self.prepare()
        for n in range(1, 5):
            self.assertEqual(self.view()["discussion_round"], n)
            self.assertEqual(self.view()["phase"], "awaiting_difference_answers")
            self.assertFalse(self.view()["candidates"])
            self.assertEqual(self.answer()["status"], "accepted")
            if n < 4:
                self.complete_interviews()
        self.assertPrivate(self.view("bob"))
        self.assertEqual(self.view("bob")["phase"], "awaiting_convergence_decision")
        self.vote("bob", "converge")
        self.assertFalse(self.view()["candidates"])
        self.vote("alice", "converge")
        self.drain()
        self.assertEqual(self.view()["phase"], "awaiting_review")
        with self.engine.store.transaction() as db:
            for row in db.execute("SELECT request FROM tasks WHERE operation IN ('idea.generate','evaluator.evaluate')"):
                self.assertPrivate(json.loads(row[0]))
            self.assertPrivate(json.loads(db.execute("SELECT snapshot FROM shared_outbox").fetchone()[0]))
        self.assertPrivate(self.view("bob"))

    def test_legacy_pending_tasks_and_sync_are_filtered_before_dispatch(self):
        self.prepare()
        self.answer()
        with self.engine.store.transaction() as db:
            state = Store.load(db, self.room)
            row = db.execute("SELECT id,request FROM tasks WHERE status='queued' AND member_id='bob'").fetchone()
            request = json.loads(row["request"])
            request["payload"].update(mode="followup", shared_context=state["round_shared_context"],
                                      followup_context=copy.deepcopy(state["members"]["alice"]["followup_context"]))
            db.execute("UPDATE tasks SET request=? WHERE id=?", (encode(request), row["id"]))
            snapshot = privacy.public_snapshot(state)
            snapshot["shared_context"] = state["round_shared_context"]
            db.execute("UPDATE shared_outbox SET snapshot=?", (encode(snapshot),))
        published = []
        class Bridge:
            def call(self, payload, **kwargs):
                published.append(payload)
                return {"revision": payload["revision"]}
        self.assertTrue(SharedSync(self.engine.store, Bridge()).run_once())
        self.assertPrivate(published)
        claims = [self.engine.claim(self.room), self.engine.claim(self.room)]
        bob = next(c for c in claims if c["request"]["payload"]["member_id"] == "bob")
        self.assertPrivate(bob)
        self.assertEqual(bob["request"]["payload"]["mode"], "initial")
        for claim in claims:
            self.assertTrue(self.engine.finish(claim["task_id"], claim["lease_token"], self.runner(claim["request"])))

    def test_new_approved_profile_is_shared_while_old_clarification_stays_private(self):
        self.prepare()
        self.answer()
        self.runner = self.engine.runner = MockRunner()
        self.complete_interviews()
        bob = self.view("bob")
        self.assertPrivate(bob)
        self.assertIn("Approved public goal for alice", json.dumps(bob["shared_context"]["profiles"]))
        self.assertNotIn("visibility", bob["difference"])
        self.assertSourcesResolve(bob["shared_context"])

    def test_personal_clarification_does_not_block_other_members_diverge(self):
        self.prepare()
        for n in range(1, 5):
            self.answer()
            if n < 4:
                self.complete_interviews()
        self.vote("bob", "diverge")
        self.assertEqual((self.view()["phase"], self.view()["discussion_round"]), ("interviewing", 5))
        self.assertEqual(self.view()["private"]["mode"], "followup")
        self.assertEqual(self.view("bob")["private"]["mode"], "initial")
        self.assertPrivate(self.view("bob"))
        with self.engine.store.transaction() as db:
            row = db.execute("SELECT request FROM tasks WHERE status='queued' AND member_id='bob'").fetchone()
            self.assertPrivate(json.loads(row[0]))
        self.complete_interviews()
        self.assertEqual(self.view()["phase"], "awaiting_difference_answers")
