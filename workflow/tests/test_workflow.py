import copy
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from jsonschema import ValidationError
from workflow.agents import MockRunner
from workflow.engine import Workflow, WorkflowError, uid
from workflow.server import make_server
from workflow.store import Store


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "state.sqlite3"
        self.runner = MockRunner()
        self.engine = Workflow(Store(self.path), self.runner)
        self.context = {"member_ids": ["alice", "bob"], "hackathon_context": "Test room",
                        "deadline_at": None, "constraints": []}
        self.created = self.engine.create_room(self.context, {"candidate_count": 2})
        self.room = self.created["room_id"]
        self.tokens = {m: self.engine.join(self.room, invite)["token"]
                       for m, invite in self.created["invitations"].items()}
        self.sequence = 0

    def tearDown(self):
        self.temp.cleanup()

    def view(self, member="alice"):
        return self.engine.view(self.tokens[member], self.room)

    def drain(self, limit=100):
        for _ in range(limit):
            if not self.engine.run_once(self.room):
                return
        self.fail("Workflow ran without reaching a human gate")

    def send(self, member, kind, payload, expected=None, event_id=None):
        v = self.view(member)
        key = {"interview.answer": "interview", "profile.approve": "interview",
               "difference.answer": "difference", "convergence.vote": "convergence"}.get(kind)
        current = (v["event_revisions"][key] if key else
                   v["event_revisions"]["review"][payload["candidate_ref"]["id"]])
        event = {"contract_version": "2.0", "event_id": event_id or uid("event"),
                 "room_id": self.room, "expected_revision": current if expected is None else expected,
                 "type": kind, "payload": payload}
        return self.engine.submit(self.tokens[member], event), event

    def complete_interviews(self):
        for _ in range(20):
            self.drain()
            if self.view()["phase"] != "interviewing":
                return
            for member in self.tokens:
                v = self.view(member)
                private = v["private"]
                if private["stage"] == "awaiting_answers":
                    result, _ = self.send(member, "interview.answer", {
                        "session_ref": private["session_ref"],
                        "question_batch_ref": private["question_batch"]["question_batch_ref"],
                        "answers": [{"question_key": q["question_key"],
                                     "text": f"PRIVATE-{member}-secret-{v['discussion_round']}", "declined": False}
                                    for q in private["question_batch"]["questions"]],
                    })
                    self.assertEqual(result["status"], "accepted")
                elif private["stage"] == "awaiting_profile_approval":
                    draft = private["draft"]
                    items = [{k: item[k] for k in ("item_key", "category", "basis", "confidence")} |
                             {"text": f"Approved public goal for {member}"}
                             for item in draft["content"]["items"]]
                    result, _ = self.send(member, "profile.approve", {
                        "draft_ref": draft["draft_ref"], "items": items, "unknowns": [],
                    })
                    self.assertEqual(result["status"], "accepted")
        self.fail("Interviews did not reach the difference gate")

    def answer_difference(self):
        v = self.view()
        for member in v["difference"]["content"]["affected_member_ids"]:
            result, _ = self.send(member, "difference.answer", {
                "difference_ref": v["difference"]["difference_ref"], "selected_option_key": None,
                "text": f"Public condition from {member}", "disagrees_with_framing": False,
            })
            self.assertEqual(result["status"], "accepted")

    def reach_convergence_gate(self, rounds=4):
        for n in range(1, rounds + 1):
            self.complete_interviews()
            self.assertEqual(self.view()["discussion_round"], n)
            self.assertEqual(self.view()["phase"], "awaiting_difference_answers")
            self.assertFalse(self.view()["candidates"])
            self.answer_difference()
            self.assertEqual(self.view()["phase"], "awaiting_convergence_decision")
            if n < rounds:
                self.vote("alice", "diverge")
        self.assertEqual(self.view()["phase"], "awaiting_convergence_decision")

    def vote(self, member, decision):
        v = self.view(member)
        return self.send(member, "convergence.vote", {
            "difference_ref": v["difference"]["difference_ref"], "discussion_round": v["discussion_round"],
            "decision": decision, "reason": "Human decision",
        })[0]

    def reach_review(self):
        self.reach_convergence_gate()
        self.vote("alice", "converge")
        self.assertEqual(self.view()["phase"], "awaiting_convergence_decision")
        self.assertFalse(self.view()["candidates"])
        self.vote("bob", "converge")
        self.drain()
        self.assertEqual(self.view()["phase"], "awaiting_review")
        return next(iter(self.view()["candidates"]))

    def review(self, member, cid, decision, instructions=""):
        v = self.view(member)
        return self.send(member, "candidate.review", {
            "candidate_ref": v["candidates"][cid]["candidate_ref"],
            "evaluation_ref": v["evaluations"][cid]["evaluation_ref"],
            "decision": decision, "instructions": instructions,
        })

    def test_complete_path_requires_real_answers_and_unanimous_accept(self):
        cid = self.reach_review()
        self.assertEqual(self.view()["evaluations"][cid]["content"]["report_status"], "partial")
        self.review("alice", cid, "accept")
        self.assertIsNone(self.view()["final_output"])
        self.review("bob", cid, "accept")
        self.assertEqual(self.view()["phase"], "completed")
        self.assertEqual(self.view()["final_output"]["candidate"]["candidate_ref"]["id"], cid)
        public = self.engine.view(self.created["admin_token"], self.room)
        self.assertNotIn("PRIVATE-", json.dumps(public))
        self.assertIsNone(public["private"])

    def test_round_one_requires_every_vote_then_generates_without_extra_interviews(self):
        self.reach_convergence_gate(rounds=1)
        before = self.view()
        self.assertFalse(self.engine.run_once(self.room))
        self.vote("alice", "converge")
        self.assertEqual(self.view()["phase"], "awaiting_convergence_decision")
        self.assertFalse(self.engine.run_once(self.room))
        self.vote("bob", "converge")
        self.drain()
        after = self.view()
        self.assertEqual((after["discussion_round"], after["phase"]), (1, "awaiting_review"))
        self.assertEqual(after["answers"], before["answers"])
        self.assertEqual(len(after["candidates"]), 2)

    def test_round_one_diverge_preserves_answers_and_requires_fresh_votes_next_round(self):
        self.reach_convergence_gate(rounds=1)
        self.vote("alice", "converge")
        self.vote("bob", "diverge")
        self.assertEqual((self.view()["discussion_round"], self.view()["phase"]), (2, "interviewing"))
        self.assertFalse(self.view()["votes"])
        self.assertFalse(self.view()["candidates"])
        self.complete_interviews()
        self.answer_difference()
        self.vote("bob", "converge")
        self.assertEqual(self.view()["phase"], "awaiting_convergence_decision")
        self.vote("alice", "converge")
        self.drain()
        self.assertEqual(self.view()["phase"], "awaiting_review")

    def test_interview_default_and_custom_caps_stop_at_summary_and_survive_restart(self):
        for cap in (None, 1, 5, 7):
            with self.subTest(cap=cap):
                config = {} if cap is None else {"question_batches_per_round": cap}
                created = self.engine.create_room(self.context, config)
                self.room = created["room_id"]
                self.tokens = {m: self.engine.join(self.room, invite)["token"]
                               for m, invite in created["invitations"].items()}
                expected = 3 if cap is None else cap
                for batch in range(1, expected + 1):
                    self.drain()
                    private = self.view()["private"]
                    self.assertEqual(private["stage"], "awaiting_answers")
                    self.assertEqual(private["batches_asked"], batch)
                    result, _ = self.send("alice", "interview.answer", {
                        "session_ref": private["session_ref"],
                        "question_batch_ref": private["question_batch"]["question_batch_ref"],
                        "answers": [{"question_key": q["question_key"], "text": "A real member answer",
                                     "declined": False} for q in private["question_batch"]["questions"]],
                    })
                    self.assertEqual(result["status"], "accepted")
                self.drain()
                private = self.view()["private"]
                self.assertEqual(private["stage"], "awaiting_profile_approval")
                self.assertEqual(private["batches_asked"], expected)
                self.assertIsNotNone(private["draft"])
                self.assertEqual(self.view()["discussion_round"], 1)
                self.engine = Workflow(Store(self.path), MockRunner())
                self.assertEqual(self.view()["config"]["question_batches_per_round"], expected)
                self.assertEqual(self.view()["private"], private)
                self.assertFalse(self.engine.run_once(self.room))

    def test_interview_cap_rejects_out_of_range_and_noninteger_values(self):
        for value in (0, 8, -1, 3.5, "3", True, None):
            with self.subTest(value=value), self.assertRaisesRegex(WorkflowError, "Invalid question_batches_per_round"):
                self.engine.create_room(self.context, {"question_batches_per_round": value})

    def test_any_diverge_at_four_reopens_interview_without_generation(self):
        self.reach_convergence_gate()
        self.vote("alice", "converge")
        self.vote("bob", "diverge")
        v = self.view()
        self.assertEqual((v["discussion_round"], v["phase"]), (5, "interviewing"))
        self.assertEqual(v["private"]["mode"], "followup")
        self.assertFalse(v["candidates"])
        self.complete_interviews()
        self.answer_difference()
        self.assertEqual(self.view()["phase"], "awaiting_convergence_decision")

    def test_minor_revision_versions_and_reconfirmation(self):
        cid = self.reach_review()
        old_ref = self.view()["candidates"][cid]["candidate_ref"]
        old_report = self.view()["evaluations"][cid]["evaluation_ref"]
        self.review("alice", cid, "minor_revision", "Only text cards")
        self.review("bob", cid, "minor_revision", "Only text cards")
        self.drain()
        v = self.view()
        self.assertEqual(v["phase"], "awaiting_review")
        self.assertEqual(v["discussion_round"], 4)
        self.assertEqual(v["candidates"][cid]["candidate_ref"]["version"], old_ref["version"] + 1)
        self.assertNotEqual(v["evaluations"][cid]["evaluation_ref"], old_report)
        self.assertFalse(v["reviews"][cid])
        result, _ = self.send("alice", "candidate.review", {
            "candidate_ref": old_ref, "evaluation_ref": old_report, "decision": "accept", "instructions": "",
        })
        self.assertEqual(result["error"]["code"], "STALE_INPUT")

    def test_more_discussion_keeps_history_and_human_gate(self):
        cid = self.reach_review()
        self.review("alice", cid, "more_discussion", "Clarify time constraints")
        self.review("bob", cid, "more_discussion", "Clarify skills")
        v = self.view()
        self.assertEqual((v["discussion_round"], v["phase"], v["private"]["mode"]), (5, "interviewing", "reopened"))
        self.assertFalse(v["candidates"])
        self.assertTrue(v["candidate_history"])
        self.complete_interviews()
        self.answer_difference()
        self.assertEqual(self.view()["phase"], "awaiting_convergence_decision")

    def test_conflicting_reviews_wait_for_humans(self):
        cid = self.reach_review()
        self.review("alice", cid, "minor_revision", "Keep feature A")
        self.review("bob", cid, "minor_revision", "Remove feature A")
        self.assertEqual(self.view()["phase"], "awaiting_review")
        self.review("bob", cid, "minor_revision", "Keep feature A")
        self.assertEqual(self.view()["phase"], "revising")

    def test_private_approvals_do_not_invalidate_other_member_tasks(self):
        first = self.engine.claim(self.room)
        second = self.engine.claim(self.room)
        self.assertNotEqual(first["request"]["payload"]["member_id"], second["request"]["payload"]["member_id"])
        self.assertTrue(self.engine.finish(first["task_id"], first["lease_token"], self.runner(first["request"])))
        self.assertTrue(self.engine.finish(second["task_id"], second["lease_token"], self.runner(second["request"])))
        self.assertEqual(self.view("alice")["private"]["stage"], "awaiting_answers")
        self.assertEqual(self.view("bob")["private"]["stage"], "awaiting_answers")

    def test_replay_conflict_and_private_ownership(self):
        self.drain()
        a, b = self.view("alice")["private"], self.view("bob")["private"]
        body = {"session_ref": a["session_ref"], "question_batch_ref": a["question_batch"]["question_batch_ref"],
                "answers": [{"question_key": "q-1", "text": "Private answer", "declined": False}]}
        wrong, _ = self.send("bob", "interview.answer", body)
        self.assertEqual(wrong["error"]["code"], "STALE_INPUT")
        result, event = self.send("alice", "interview.answer", body)
        self.assertEqual(self.engine.submit(self.tokens["alice"], event), result)
        with self.store_transaction() as db:
            audit = db.execute("SELECT event,received_at FROM events WHERE event_id=?", (event["event_id"],)).fetchone()
            self.assertEqual(json.loads(audit["event"]), event)
            self.assertTrue(audit["received_at"].endswith("+00:00"))
        altered = copy.deepcopy(event)
        altered["payload"]["answers"][0]["text"] = "different"
        with self.assertRaises(WorkflowError) as caught:
            self.engine.submit(self.tokens["alice"], altered)
        self.assertEqual(caught.exception.code, "CONFLICT")
        self.assertNotIn("Private answer", json.dumps(self.view("bob")))
        self.assertEqual(b["revision"], self.view("bob")["private"]["revision"])

    def test_persistence_restart_does_not_rerun_completed_tasks(self):
        self.drain()
        before = self.view()
        self.engine = Workflow(Store(self.path), MockRunner())
        self.assertFalse(self.engine.run_once(self.room))
        after = self.view()
        self.assertEqual(before["calls_started"], after["calls_started"])
        self.assertEqual(before["private"], after["private"])

    def test_failed_output_requires_retry_and_correct_schema(self):
        class BadRunner(MockRunner):
            def __call__(self, request):
                response = super().__call__(request)
                response["request_id"] = "forged"
                return response
        self.engine.runner = BadRunner()
        self.drain()
        self.assertEqual(self.view()["phase"], "interviewing")
        self.assertTrue(all(t["status"] == "failed" for t in self.view()["tasks"]))
        self.engine.runner = MockRunner()
        with self.store_transaction() as db:
            ids = [r["id"] for r in db.execute("SELECT id FROM tasks WHERE status='failed'")]
        for task_id in ids:
            self.engine.retry(self.created["admin_token"], self.room, task_id)
        self.drain()
        self.assertEqual(self.view()["private"]["stage"], "awaiting_answers")

    def store_transaction(self):
        return self.engine.store.transaction()

    def test_legacy_budget_pause_resumes_without_becoming_consensus(self):
        with self.store_transaction() as db:
            s = Store.load(db, self.room)
            s["config"]["max_agent_calls"] = 1
            s["calls_started"] = 10001
            s["paused_reason"] = "agent_budget"
            Store.save(db, s)
        self.drain()
        self.assertIsNone(self.view()["final_output"])
        self.assertIsNone(self.view()["paused_reason"])
        self.assertIsNone(self.view()["config"]["max_agent_calls"])
        self.assertEqual(self.view()["calls_started"], 10003)
        self.assertEqual(self.view("bob")["private"]["stage"], "awaiting_answers")

    def test_late_result_cannot_revive_stopped_room(self):
        claim = self.engine.claim(self.room)
        self.engine.stop(self.created["admin_token"], self.room)
        self.assertFalse(self.engine.finish(claim["task_id"], claim["lease_token"], self.runner(claim["request"])))
        self.assertEqual(self.view()["phase"], "ended")

    def test_recovered_lease_ignores_original_worker(self):
        claim = self.engine.claim(self.room)
        with self.store_transaction() as db:
            db.execute("UPDATE tasks SET lease_until=0 WHERE id=?", (claim["task_id"],))
        reclaimed = self.engine.claim(self.room)
        # Whichever queued task is chosen, the old lease cannot commit if reclaimed.
        if reclaimed["task_id"] != claim["task_id"]:
            self.engine.finish(reclaimed["task_id"], reclaimed["lease_token"], self.runner(reclaimed["request"]))
            reclaimed = self.engine.claim(self.room)
        self.assertEqual(reclaimed["task_id"], claim["task_id"])
        self.assertFalse(self.engine.finish(claim["task_id"], claim["lease_token"], self.runner(claim["request"])))
        self.assertTrue(self.engine.finish(reclaimed["task_id"], reclaimed["lease_token"], self.runner(reclaimed["request"])))

    def test_cross_room_and_single_use_invitations(self):
        other = self.engine.create_room(self.context)
        with self.assertRaises(WorkflowError):
            self.engine.view(self.tokens["alice"], other["room_id"])
        with self.assertRaises(WorkflowError):
            self.engine.join(self.room, self.created["invitations"]["alice"])

    def test_http_api_auth_and_safe_errors(self):
        server = make_server(self.engine, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(base + "/api/health") as response:
                self.assertEqual(json.load(response)["agent_mode"], "mock")
            for config, expected in (({}, 3), ({"question_batches_per_round": 5}, 5)):
                request = Request(base + "/api/rooms",
                                  data=json.dumps({"room_context": self.context, "config": config}).encode(),
                                  headers={"Content-Type": "application/json"}, method="POST")
                with urlopen(request) as response:
                    self.assertEqual(response.status, 201)
                    created = json.load(response)
                request = Request(base + "/api/rooms/" + created["room_id"],
                                  headers={"Authorization": "Bearer " + created["admin_token"]})
                with urlopen(request) as response:
                    self.assertEqual(json.load(response)["config"]["question_batches_per_round"], expected)
            with urlopen(base + "/") as response:
                self.assertIn(b"considea", response.read())
            for path, mime in [("/app.js", "text/javascript"), ("/atmosphere.js", "text/javascript"), ("/style.css", "text/css")]:
                with urlopen(base + path) as response:
                    self.assertIn(mime, response.headers["Content-Type"])
                    self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                    self.assertTrue(response.read())
            for path in ["/.env", "/../.env", "/web/../server.py", "/%2e%2e/server.py"]:
                with self.assertRaises(HTTPError) as missing:
                    urlopen(base + path)
                self.assertEqual(missing.exception.code, 404)
            with self.assertRaises(HTTPError) as caught:
                urlopen(base + "/api/rooms/" + self.room)
            self.assertEqual(caught.exception.code, 401)
            request = Request(base + "/api/rooms/" + self.room,
                              headers={"Authorization": "Bearer " + self.tokens["alice"]})
            with urlopen(request) as response:
                self.assertEqual(json.load(response)["actor"]["member_id"], "alice")
            bad = Request(base + "/api/rooms", data=b"{}",
                          headers={"Content-Type": "application/json"}, method="POST")
            with self.assertRaises(HTTPError) as caught:
                urlopen(bad)
            self.assertEqual(caught.exception.code, 400)
            bad_invite = Request(base + "/api/rooms/" + self.room + "/join",
                                 data=b'{"invitation":17}',
                                 headers={"Content-Type": "application/json"}, method="POST")
            with self.assertRaises(HTTPError) as caught:
                urlopen(bad_invite)
            self.assertEqual(caught.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


    def test_early_votes_and_missing_difference_answers_cannot_advance(self):
        self.complete_interviews()
        v = self.view()
        self.assertEqual(self.vote("alice", "converge")["error"]["code"], "STALE_INPUT")
        result, _ = self.send("alice", "convergence.vote", {
            "difference_ref": v["difference"]["difference_ref"], "discussion_round": 4,
            "decision": "converge", "reason": "Try to bypass the early round",
        })
        self.assertEqual(result["error"]["code"], "STALE_INPUT")
        self.send("alice", "difference.answer", {
            "difference_ref": v["difference"]["difference_ref"], "selected_option_key": None,
            "text": "Need a weekend MVP", "disagrees_with_framing": False,
        })
        self.assertEqual((self.view()["discussion_round"], self.view()["phase"]), (1, "awaiting_difference_answers"))
        self.assertFalse(self.engine.run_once(self.room))
        self.send("bob", "difference.answer", {
            "difference_ref": v["difference"]["difference_ref"], "selected_option_key": None,
            "text": "Avoid paid data", "disagrees_with_framing": False,
        })
        self.assertEqual(self.view()["phase"], "awaiting_convergence_decision")
        self.assertIsNone(self.engine.claim(self.room))
        self.vote("bob", "diverge")
        claim = self.engine.claim(self.room)
        followup = claim["request"]["payload"]["followup_context"]
        self.assertEqual({a["member_id"] for a in followup["answers"]}, {"alice", "bob"})
        self.assertEqual(followup["difference"]["difference_ref"], v["difference"]["difference_ref"])
        self.assertNotIn("PRIVATE-", json.dumps(claim["request"]["payload"]["shared_context"]))

    def test_binary_difference_rejects_invalid_answers_and_accepts_framing_correction(self):
        class BinaryRunner(MockRunner):
            def __call__(self, request):
                response = super().__call__(request)
                if request["operation"] == "negotiate.detect":
                    response["data"]["difference"].update(
                        answer_type="binary",
                        options=[{"key": "yes", "label": "Yes"}, {"key": "no", "label": "No"}],
                        affected_member_ids=["alice"],
                    )
                return response
        self.engine.runner = BinaryRunner()
        self.complete_interviews()
        diff = self.view()["difference"]
        payload = {"difference_ref": diff["difference_ref"], "selected_option_key": None,
                   "text": "This question omits the data constraint", "disagrees_with_framing": False}
        result, _ = self.send("bob", "difference.answer", payload)
        self.assertEqual(result["error"]["code"], "UNAUTHORIZED")
        result, _ = self.send("alice", "difference.answer", payload)
        self.assertEqual(result["error"]["code"], "INVALID_EVENT")
        self.assertFalse(self.view()["answers"])
        payload["disagrees_with_framing"] = True
        result, _ = self.send("alice", "difference.answer", payload)
        self.assertEqual(result["status"], "accepted")
        self.assertEqual((self.view()["discussion_round"], self.view()["phase"]), (1, "awaiting_convergence_decision"))

    def test_blank_revision_instructions_do_not_dispatch_agent(self):
        cid = self.reach_review()
        before = self.view()["calls_started"]
        for decision in ("minor_revision", "more_discussion"):
            with self.assertRaises(ValidationError):
                self.review("alice", cid, decision, "   ")
        self.assertEqual(self.view()["phase"], "awaiting_review")
        self.assertEqual(self.view()["calls_started"], before)
        self.assertFalse(self.view()["reviews"])

    def test_concurrent_workers_claim_each_initial_task_once(self):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: self.engine.run_once(self.room), range(4)))
        self.assertEqual(self.view()["calls_started"], 2)
        for member in self.tokens:
            v = self.view(member)
            self.assertEqual(v["private"]["stage"], "awaiting_answers")
            self.assertTrue(all(t["attempts"] == 1 for t in v["tasks"]))


if __name__ == "__main__":
    unittest.main()
