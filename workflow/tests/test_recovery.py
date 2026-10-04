"""Fault injection at durable workflow boundaries. No model/network calls."""
import copy
from contextlib import closing
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from workflow.agents import MockRunner
from workflow.engine import Workflow, WorkflowError
from workflow.integration import IntegrationError
from workflow.store import Store
from workflow.tests import test_workflow as base


def failure(request, code="MODEL_TIMEOUT", retryable=True):
    return {**{k: request[k] for k in ("schema_version", "request_id", "room_id", "operation", "input_revision")},
            "status": "error", "data": {}, "warnings": [],
            "error": {"code": code, "message": "PRIVATE-provider-detail", "retryable": retryable}}


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "state.sqlite3"
        self.runner = MockRunner()
        self.engine = Workflow(Store(self.path), self.runner)
        self.created = self.engine.create_room({"member_ids": ["alice"], "hackathon_context": "Synthetic recovery test",
            "deadline_at": None, "constraints": []})
        self.room = self.created["room_id"]
        self.token = self.engine.join(self.room, self.created["invitations"]["alice"])["token"]

    def view(self):
        return self.engine.view(self.token, self.room)

    def row(self):
        with self.engine.store.transaction() as db:
            return dict(db.execute("SELECT * FROM tasks WHERE room_id=? ORDER BY attempts DESC,created_at DESC", (self.room,)).fetchone())

    def attempts(self):
        with self.engine.store.transaction() as db:
            return [dict(r) for r in db.execute("SELECT * FROM task_attempts WHERE task_id=? ORDER BY attempt", (self.row_id,))]

    def test_invalid_output_preserves_input_and_diagnostics_for_manual_retry(self):
        owner = self
        class Bad(MockRunner):
            def __call__(self, request):
                owner.original = copy.deepcopy(request)
                response = super().__call__(request)
                response["request_id"] = "PRIVATE-forged-identifier"
                return response
        self.engine.runner = Bad()
        self.engine.run_once(self.room)
        t = self.view()["tasks"][0]; self.row_id = t["task_id"]
        self.assertEqual((t["status"], t["error"]["code"], t["auto_retries"]), ("failed", "INVALID_OUTPUT", 0))
        self.assertFalse(self.engine.run_once(self.room))
        self.assertNotIn("PRIVATE-", json.dumps(self.view()))
        self.assertIn("PRIVATE-forged", self.attempts()[0]["result"])
        self.engine = Workflow(Store(self.path), self.runner)
        self.engine.retry(self.token, self.room, self.row_id)
        c = self.engine.claim(self.room)
        self.assertEqual(c["request"], self.original)
        self.assertTrue(self.engine.finish(c["task_id"], c["lease_token"], self.runner(c["request"])))
        self.assertEqual([r["outcome"] for r in self.attempts()], ["failed", "done"])
        self.assertIn("PRIVATE-forged", self.attempts()[0]["result"])
        self.assertEqual(self.view()["private"]["stage"], "awaiting_answers")
        self.assertEqual(self.view()["discussion_round"], 1)

    def test_backoff_survives_restart_and_exhausts_after_two_retries(self):
        class Timeout(MockRunner):
            def __call__(self, request):
                return failure(request)
        self.engine.runner = Timeout()
        timestamp = 1000
        for attempt in range(1, 4):
            with patch("workflow.engine.time.time", return_value=timestamp):
                self.assertTrue(self.engine.run_once(self.room))
                row = self.row(); self.row_id = row["id"]
                self.assertEqual(row["attempts"], attempt)
                self.assertFalse(self.engine.run_once(self.room))
                self.engine = Workflow(Store(self.path), Timeout())
                self.assertIsNone(self.engine.claim(self.room))
                if attempt < 3:
                    self.assertEqual(row["status"], "queued")
                    delay = row["next_attempt_at"] - timestamp
                    self.assertGreaterEqual(delay, 2 ** attempt)
                    self.assertLess(delay, 2 ** attempt + 1)
                    timestamp = row["next_attempt_at"]
                else:
                    self.assertEqual(row["status"], "failed")
        self.assertEqual(self.view()["calls_started"], 3)
        self.assertEqual(len(self.attempts()), 3)
        self.assertIsNone(self.view()["final_output"])
        self.engine.retry(self.token, self.room, self.row_id)
        self.assertEqual(self.row()["auto_retries"], 0)
        self.assertEqual(self.row()["attempts"], 3)

    def test_non_transient_errors_never_auto_retry_even_if_agent_requests_it(self):
        for code in ("INVALID_OUTPUT", "INVALID_INPUT", "CONFIG_ERROR", "BUDGET_EXCEEDED", "TOOL_UNAVAILABLE"):
            with self.subTest(code=code):
                c = self.engine.claim(self.room)
                self.engine.finish(c["task_id"], c["lease_token"], failure(c["request"], code))
                t = self.view()["tasks"][0]
                self.assertEqual(t["status"], "failed")
                self.assertEqual(t["error"]["code"], code)
                self.assertEqual(t["auto_retries"], 0)
                self.assertFalse(self.engine.run_once(self.room))
                self.engine.retry(self.token, self.room, t["task_id"])

    def test_bridge_timeouts_retry_but_unknown_exceptions_and_config_do_not(self):
        for code, expected in (("BRIDGE_TIMEOUT", "queued"), ("EVALUATOR_NOT_READY", "failed"), ("INTEGRATION_ERROR", "failed")):
            with self.subTest(code=code):
                class Broken(MockRunner):
                    def __call__(self, request):
                        raise IntegrationError(code)
                self.engine.runner = Broken()
                self.engine.run_once(self.room)
                self.assertEqual(self.row()["status"], expected)
                self.assertNotIn("PRIVATE-", json.dumps(self.view()))
                # Each next case uses an explicit retry cycle, not an automatic loop.
                with self.engine.store.transaction() as db:
                    db.execute("UPDATE tasks SET status='failed' WHERE room_id=?", (self.room,))
                self.engine.retry(self.token, self.room, self.row()["id"])

    def test_retry_wait_does_not_block_other_room_and_budget_still_applies(self):
        c = self.engine.claim(self.room)
        with patch("workflow.engine.time.time", return_value=1000):
            self.engine.finish(c["task_id"], c["lease_token"], failure(c["request"]))
            other = self.engine.create_room({"member_ids": ["bob"], "hackathon_context": "Other room",
                                            "deadline_at": None, "constraints": []})
            self.assertTrue(self.engine.run_once())
            self.assertEqual(self.engine.view(other["admin_token"], other["room_id"])["members"]["bob"]["stage"], "awaiting_answers")
        with self.engine.store.transaction() as db:
            s = Store.load(db, self.room); s["config"]["max_agent_calls"] = 1; Store.save(db, s)
        self.assertIsNone(self.engine.claim(self.room))
        self.assertEqual(self.view()["paused_reason"], "agent_budget")
        self.assertIsNone(self.view()["final_output"])
        self.engine.increase_budget(self.created["admin_token"], self.room, 2)
        self.assertTrue(self.engine.run_once(self.room))
        self.assertEqual(self.view()["calls_started"], 2)

    def test_expired_lease_cannot_commit_or_renew_even_before_takeover(self):
        with patch("workflow.engine.time.time", return_value=1000):
            old = self.engine.claim(self.room)
        with patch("workflow.engine.time.time", return_value=1121):
            self.assertFalse(self.engine.renew(old["task_id"], old["lease_token"]))
            self.assertFalse(self.engine.finish(old["task_id"], old["lease_token"], self.runner(old["request"])))
            replacement = self.engine.claim(self.room)
            self.assertEqual(replacement["request"], old["request"])
            self.assertEqual(replacement["attempt"], 2)
            self.assertFalse(self.engine.finish(old["task_id"], old["lease_token"], self.runner(old["request"])))
            response = self.runner(replacement["request"])
            self.assertTrue(self.engine.finish(replacement["task_id"], replacement["lease_token"], response))
            self.assertFalse(self.engine.finish(replacement["task_id"], replacement["lease_token"], response))
        self.assertEqual(self.view()["private"]["revision"], 2)

    def test_repeated_worker_crashes_are_bounded(self):
        for attempt, timestamp in enumerate((1000, 1121, 1242), start=1):
            with patch("workflow.engine.time.time", return_value=timestamp):
                c = self.engine.claim(self.room)
                self.assertEqual(c["attempt"], attempt)
        with patch("workflow.engine.time.time", return_value=1363):
            self.assertIsNone(self.engine.claim(self.room))
        self.assertEqual(self.row()["status"], "failed")
        self.assertEqual(json.loads(self.row()["error"])["code"], "LEASE_EXPIRED")
        self.assertEqual(self.view()["calls_started"], 3)

    def test_running_agent_renews_lease_and_prevents_duplicate_dispatch(self):
        entered, release, renewed = threading.Event(), threading.Event(), threading.Event()
        clock = [1000]
        class Slow(MockRunner):
            def __call__(self, request):
                entered.set()
                if not release.wait(5):
                    raise RuntimeError("Test failed to release the runner")
                return super().__call__(request)
        self.engine = Workflow(self.engine.store, Slow(), lease_seconds=3)
        original_renew = self.engine.renew
        def watch(*args):
            result = original_renew(*args)
            if result: renewed.set()
            return result
        with patch("workflow.engine.time.time", side_effect=lambda: clock[0]), patch.object(self.engine, "renew", side_effect=watch):
            worker = threading.Thread(target=self.engine.run_once, args=(self.room,))
            worker.start()
            try:
                self.assertTrue(entered.wait(2))
                clock[0] = 1002
                self.assertTrue(renewed.wait(2))
                clock[0] = 1004  # Original lease expired; renewed lease is still owned.
                self.assertIsNone(self.engine.claim(self.room))
            finally:
                release.set(); worker.join(timeout=3)
            self.assertFalse(worker.is_alive())
        self.assertEqual(self.row()["status"], "done")
        self.assertEqual(self.view()["calls_started"], 1)

    def test_stop_cancels_scheduled_retry_and_rejects_late_results(self):
        c = self.engine.claim(self.room)
        self.engine.finish(c["task_id"], c["lease_token"], failure(c["request"]))
        self.engine.stop(self.created["admin_token"], self.room)
        self.assertFalse(self.engine.run_once(self.room))
        self.assertFalse(self.engine.renew(c["task_id"], c["lease_token"]))
        with self.assertRaises(WorkflowError):
            self.engine.retry(self.token, self.room, c["task_id"])
        self.assertEqual(self.row()["status"], "cancelled")

    def test_application_failure_rolls_back_state_outbox_and_downstream_tasks(self):
        self.engine.run_once(self.room)
        v = self.view(); q = v["private"]["question_batch"]
        self.engine.submit(self.token, {"contract_version": "2.0", "event_id": "answer", "room_id": self.room,
            "expected_revision": v["event_revisions"]["interview"], "type": "interview.answer", "payload": {
                "session_ref": v["private"]["session_ref"], "question_batch_ref": q["question_batch_ref"],
                "answers": [{"question_key": q["questions"][0]["question_key"], "text": "Saved answer", "declined": False}]}})
        c = self.engine.claim(self.room)
        with self.engine.store.transaction() as db:
            before = (Store.load(db, self.room), db.execute("SELECT snapshot FROM shared_outbox").fetchone()[0],
                      db.execute("SELECT count(*) FROM tasks").fetchone()[0])
        original = self.engine._apply_result
        def crash_after_queue(*args):
            original(*args)
            raise RuntimeError("PRIVATE-apply-detail")
        with patch.object(self.engine, "_apply_result", side_effect=crash_after_queue):
            self.assertFalse(self.engine.finish(c["task_id"], c["lease_token"], self.runner(c["request"])))
        with self.engine.store.transaction() as db:
            after = (Store.load(db, self.room), db.execute("SELECT snapshot FROM shared_outbox").fetchone()[0],
                     db.execute("SELECT count(*) FROM tasks").fetchone()[0])
        self.assertEqual(before, after)
        self.assertEqual(self.row()["status"], "failed")
        self.assertEqual(json.loads(self.row()["error"])["code"], "APPLY_FAILED")
        self.assertNotIn("PRIVATE-", json.dumps(self.view()))
        self.engine.retry(self.token, self.room, c["task_id"])
        self.engine.run_once(self.room)
        self.engine.run_once(self.room)
        self.assertEqual(self.view()["private"]["stage"], "awaiting_profile_approval")

    def test_disabled_auto_retry_and_private_task_ownership(self):
        created = self.engine.create_room({"member_ids": ["alice", "bob"], "hackathon_context": "Private retry",
            "deadline_at": None, "constraints": []}, {"max_task_retries": 0})
        rid = created["room_id"]
        tokens = {m: self.engine.join(rid, invite)["token"] for m, invite in created["invitations"].items()}
        c = self.engine.claim(rid)
        owner = c["request"]["payload"]["member_id"]
        other = "bob" if owner == "alice" else "alice"
        self.engine.finish(c["task_id"], c["lease_token"], failure(c["request"]))
        own_view = self.engine.view(tokens[owner], rid)
        self.assertEqual(own_view["tasks"][0]["status"], "failed")
        self.assertNotIn(c["task_id"], [t["task_id"] for t in self.engine.view(tokens[other], rid)["tasks"]])
        with self.assertRaises(WorkflowError):
            self.engine.retry(tokens[other], rid, c["task_id"])
        self.assertEqual(self.engine.retry(tokens[owner], rid, c["task_id"])["status"], "queued")

    def test_scheduled_retry_rechecks_dependencies_before_dispatch(self):
        c = self.engine.claim(self.room)
        self.engine.finish(c["task_id"], c["lease_token"], failure(c["request"]))
        with self.engine.store.transaction() as db:
            s = Store.load(db, self.room)
            s["members"]["alice"]["revision"] += 1
            Store.save(db, s)
        with patch("workflow.engine.time.time", return_value=self.row()["next_attempt_at"] + 1):
            self.assertIsNone(self.engine.claim(self.room))
        self.assertEqual(self.row()["status"], "stale")
        self.assertEqual(self.view()["calls_started"], 1)
        with self.assertRaises(WorkflowError):
            self.engine.retry(self.token, self.room, c["task_id"])

    def test_additive_migration_preserves_legacy_rows_and_failures(self):
        legacy = Path(self.temp.name) / "legacy.sqlite3"
        with closing(sqlite3.connect(legacy)) as db:
            db.execute("""CREATE TABLE tasks (id TEXT PRIMARY KEY,room_id TEXT,member_id TEXT,operation TEXT,
                request TEXT,dependencies TEXT,status TEXT,attempts INTEGER,lease_token TEXT,lease_until REAL,
                result TEXT,error TEXT,created_at TEXT)""")
            db.execute("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                "old", "room", "alice", "interview.turn", "{}", "{}", "failed", 1, None, None,
                '{"status":"error"}', '{"code":"INVALID_OUTPUT"}', "old-time"))
            db.commit()
        Store(legacy); store = Store(legacy)
        with store.transaction() as db:
            row = db.execute("SELECT * FROM tasks").fetchone()
            self.assertEqual((row["id"], row["auto_retries"], row["next_attempt_at"]), ("old", 0, 0))
            self.assertEqual(db.execute("SELECT result FROM task_attempts").fetchone()[0], row["result"])
            self.assertEqual(db.execute("SELECT count(*) FROM task_attempts").fetchone()[0], 1)


class RevisionRecoveryTests(unittest.TestCase):
    setUp = base.WorkflowTests.setUp
    tearDown = base.WorkflowTests.tearDown
    view = base.WorkflowTests.view
    send = base.WorkflowTests.send
    drain = base.WorkflowTests.drain
    complete_interviews = base.WorkflowTests.complete_interviews
    answer_difference = base.WorkflowTests.answer_difference
    reach_convergence_gate = base.WorkflowTests.reach_convergence_gate
    reach_review = base.WorkflowTests.reach_review
    review = base.WorkflowTests.review
    vote = base.WorkflowTests.vote
    store_transaction = base.WorkflowTests.store_transaction

    def test_generation_budget_failure_preserves_round_four_votes_and_retries(self):
        self.reach_convergence_gate()
        self.vote("alice", "converge")
        self.assertEqual(self.view()["phase"], "awaiting_convergence_decision")
        self.assertFalse(any(t["operation"] == "idea.generate" for t in self.view()["tasks"]))
        self.vote("bob", "converge")
        before = self.view()
        claim = self.engine.claim(self.room)
        self.assertEqual(claim["request"]["operation"], "idea.generate")
        self.assertFalse(self.engine.finish(claim["task_id"], claim["lease_token"],
                                           failure(claim["request"], "BUDGET_EXCEEDED", False)))
        failed = self.view()
        for key in ("discussion_round", "phase", "answers", "votes", "convergence_decision", "shared_context"):
            self.assertEqual(failed[key], before[key])
        self.assertEqual(failed["phase"], "idea_generating")
        self.assertFalse(failed["candidates"])
        task = next(t for t in failed["tasks"] if t["task_id"] == claim["task_id"])
        self.assertEqual((task["status"], task["error"]["code"], task["auto_retries"]),
                         ("failed", "BUDGET_EXCEEDED", 0))
        self.assertFalse(self.engine.run_once(self.room))
        self.engine = Workflow(Store(self.path), MockRunner())
        self.engine.retry(self.tokens["alice"], self.room, task["task_id"])
        retry = self.engine.claim(self.room)
        self.assertEqual(retry["request"], claim["request"])
        self.assertTrue(self.engine.finish(retry["task_id"], retry["lease_token"], self.runner(retry["request"])))
        self.drain()
        resumed = self.view()
        self.assertEqual(resumed["phase"], "awaiting_review")
        for key in ("discussion_round", "answers", "votes", "convergence_decision"):
            self.assertEqual(resumed[key], before[key])
        self.assertEqual(len(resumed["candidates"]), 2)
        self.assertIsNone(resumed["final_output"])

    def test_failed_revision_keeps_four_rounds_and_human_reviews_then_resumes(self):
        cid = self.reach_review()
        old = self.view()["candidates"][cid]
        self.review("alice", cid, "minor_revision", "Text only")
        self.review("bob", cid, "minor_revision", "Text only")
        before = self.view()
        class BadRevision(MockRunner):
            def __call__(self, request):
                if request["operation"] == "idea.revise":
                    return failure(request, "INVALID_OUTPUT", False)
                return super().__call__(request)
        self.engine.runner = BadRevision()
        self.drain()
        failed = self.view()
        for key in ("discussion_round", "candidates", "evaluations", "reviews", "shared_context", "votes"):
            self.assertEqual(failed[key], before[key])
        task = next(t for t in failed["tasks"] if t["status"] == "failed")
        self.assertEqual(task["operation"], "idea.revise")
        self.engine = Workflow(Store(self.path), MockRunner())
        self.engine.retry(self.tokens["alice"], self.room, task["task_id"])
        self.drain()
        resumed = self.view()
        self.assertEqual(resumed["discussion_round"], 4)
        self.assertEqual(resumed["phase"], "awaiting_review")
        self.assertEqual(resumed["candidates"][cid]["candidate_ref"]["version"], old["candidate_ref"]["version"] + 1)
        self.assertFalse(resumed["reviews"][cid])
        self.assertIsNone(resumed["final_output"])
        self.review("alice", cid, "accept")
        self.assertIsNone(self.view()["final_output"])
        self.review("bob", cid, "accept")
        self.assertEqual(self.view()["phase"], "completed")
