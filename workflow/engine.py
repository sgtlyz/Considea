"""Durable state machine. Human events, not model text, authorize transitions."""
import copy
import json
import secrets
import time
from datetime import datetime, timezone
from uuid import uuid4

from . import protocol
from .store import Store, digest, encode, token_hash


def uid(prefix):
    return prefix + "-" + uuid4().hex


def now():
    return datetime.now(timezone.utc).isoformat()


def ref(identifier, version=1):
    return {"id": identifier, "version": version}


class WorkflowError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def need(condition, message, code="INVALID_EVENT"):
    if not condition:
        raise WorkflowError(code, message, 409 if code in ("STALE_INPUT", "CONFLICT") else 400)


class Workflow:
    def __init__(self, store, runner, lease_seconds=120):
        self.store, self.runner, self.lease_seconds = store, runner, lease_seconds

    def _auth(self, db, token, room_id=None, admin=False):
        row = db.execute("SELECT * FROM credentials WHERE token_hash=?", (token_hash(token),)).fetchone()
        if not row or (room_id and row["room_id"] != room_id) or (admin and row["role"] != "admin"):
            raise WorkflowError("UNAUTHORIZED", "Invalid credentials for this operation", 403)
        return dict(row)

    def _room(self, db, room_id):
        state = Store.load(db, room_id)
        if state is None:
            raise WorkflowError("NOT_FOUND", "Room not found", 404)
        return state

    def create_room(self, room_context, config=None):
        protocol.ROOM_CONTEXT.validate(room_context)
        need(len(room_context["member_ids"]) <= 12, "At most 12 members")
        settings = {"question_batches_per_round": 1, "max_questions": 3, "candidate_count": 3,
                    "max_agent_calls": 200, "search_enabled": False, "max_search_queries": 0,
                    "decision_policy": "unanimous"}
        config = {} if config is None else config
        need(isinstance(config, dict) and set(config) <= set(settings), "Unknown room configuration")
        settings.update(config)
        for key, low, high in (("question_batches_per_round", 1, 7), ("max_questions", 1, 3),
                               ("candidate_count", 1, 5), ("max_agent_calls", 1, 10000),
                               ("max_search_queries", 0, 50)):
            need(type(settings[key]) is int and low <= settings[key] <= high, "Invalid " + key)
        need(type(settings["search_enabled"]) is bool, "search_enabled must be boolean")
        need(settings["decision_policy"] == "unanimous", "Only the confirmed unanimous policy is supported")
        room_id, admin_token = uid("room"), secrets.token_urlsafe(32)
        members = {m: {"revision": 0, "messages": [], "profile": None, "approved_round": 0}
                   for m in room_context["member_ids"]}
        state = {"room_id": room_id, "revision": 0, "serial": 0, "room_context": room_context,
                 "config": settings, "mode": self.runner.mode, "phase": "setup", "discussion_round": 1,
                 "members": members, "sources": [], "discussion_history": [], "difference": None,
                 "answers": {}, "answer_revisions": {}, "votes": {}, "vote_revisions": {},
                 "convergence_decision": None, "candidates": {}, "evaluations": {}, "reviews": {},
                 "review_revisions": {}, "candidate_history": [], "selected_candidate_ref": None,
                 "calls_started": 0, "paused_reason": None, "created_at": now()}
        invitations = {}
        with self.store.transaction() as db:
            db.execute("INSERT INTO rooms VALUES(?,?)", (room_id, encode(state)))
            db.execute("INSERT INTO credentials VALUES(?,?,?,?)",
                       (token_hash(admin_token), room_id, "admin", None))
            for member in members:
                invitation = secrets.token_urlsafe(32)
                invitations[member] = invitation
                db.execute("INSERT INTO invitations(token_hash,room_id,member_id) VALUES(?,?,?)",
                           (token_hash(invitation), room_id, member))
            self._begin_round(db, state, "initial", None, increment=False)
            Store.save(db, state)
        return {"room_id": room_id, "admin_token": admin_token, "invitations": invitations,
                "mode": self.runner.mode}

    def join(self, room_id, invitation):
        need(isinstance(invitation, str) and bool(invitation), "Invitation must be a nonempty string", "INVALID_INPUT")
        with self.store.transaction() as db:
            row = db.execute("SELECT * FROM invitations WHERE token_hash=? AND room_id=?",
                             (token_hash(invitation), room_id)).fetchone()
            if not row or row["used"]:
                raise WorkflowError("UNAUTHORIZED", "Invitation invalid or already used", 403)
            token = secrets.token_urlsafe(32)
            db.execute("UPDATE invitations SET used=1 WHERE token_hash=?", (row["token_hash"],))
            db.execute("INSERT INTO credentials VALUES(?,?,?,?)",
                       (token_hash(token), room_id, "member", row["member_id"]))
            return {"room_id": room_id, "member_id": row["member_id"], "token": token}

    def _shared(self, s):
        return {"profiles": [m["profile"] for m in s["members"].values() if m["profile"] is not None],
                "discussion_history": s["discussion_history"], "sources": s["sources"]}

    def _source(self, s, kind, object_ref, text, member=None):
        source_id = uid("source")
        s["sources"].append({"source_id": source_id, "kind": kind, "object_ref": object_ref,
                             "member_id": member, "discussion_round": s["discussion_round"], "text": text})
        fields = {"profile_item": "profile_source_ids", "difference": "difference_source_ids",
                  "difference_answer": "answer_source_ids", "convergence_decision": "convergence_source_ids",
                  "human_review": "review_source_ids"}
        if kind in fields:
            s["discussion_history"][-1][fields[kind]].append(source_id)
        return source_id

    def _base_payload(self, s):
        return {"contract_version": "2.0", "discussion_round": s["discussion_round"],
                "room_context": s["room_context"]}

    def _dependencies(self, s, operation, member_id=None, candidate_id=None):
        deps = {"round": s["discussion_round"], "phase": s["phase"]}
        if member_id:
            deps["member_revision"] = s["members"][member_id]["revision"]
        if candidate_id:
            deps["candidate_ref"] = s["candidates"].get(candidate_id, {}).get("candidate_ref")
        return deps

    def _enqueue(self, db, s, operation, payload, member_id=None, candidate_id=None):
        s["serial"] += 1
        request = {"schema_version": "1.0", "request_id": uid("request"), "room_id": s["room_id"],
                   "operation": operation, "input_revision": s["serial"], "payload": copy.deepcopy(payload)}
        protocol.REQUEST.validate(request)
        deps = self._dependencies(s, operation, member_id, candidate_id)
        deps["candidate_id"] = candidate_id
        db.execute("""INSERT INTO tasks
            (id,room_id,member_id,operation,request,dependencies,status,created_at)
            VALUES(?,?,?,?,?,?,'queued',?)""",
            (request["request_id"], s["room_id"], member_id, operation, encode(request), encode(deps), now()))
        return request["request_id"]

    def _begin_round(self, db, s, mode, followup, increment=True):
        if increment:
            s["discussion_round"] += 1
        s["phase"] = "interviewing"
        s["discussion_history"].append({
            "discussion_round": s["discussion_round"], "profile_source_ids": [], "difference_source_ids": [],
            "answer_source_ids": [], "convergence_source_ids": [], "review_source_ids": [],
        })
        shared = copy.deepcopy(self._shared(s))
        s["round_shared_context"] = shared
        for member_id, member in s["members"].items():
            member.update(revision=member["revision"] + 1, mode=mode, stage="queued_turn",
                          session_ref=ref(uid("session")), question_batch=None, draft=None,
                          batches_asked=0, interview_turn=1, followup_context=copy.deepcopy(followup))
            self._queue_interview(db, s, member_id)
        s["answers"], s["votes"] = {}, {}
        s["answer_revisions"], s["vote_revisions"] = {}, {}
        s["convergence_decision"] = None

    def _queue_interview(self, db, s, member_id, summarize=False, stop_reason=None):
        m = s["members"][member_id]
        payload = {**self._base_payload(s), "member_id": member_id, "mode": m["mode"],
                   "messages": m["messages"], "current_profile": m["profile"],
                   "shared_context": s["round_shared_context"], "followup_context": m["followup_context"]}
        if summarize:
            m["stage"] = "queued_summary"
            payload["stop_reason"] = stop_reason
            op = "interview.summarize"
        else:
            m["stage"] = "queued_turn"
            payload.update(interview_turn=m["interview_turn"], limits={
                "max_questions": s["config"]["max_questions"],
                "remaining_question_batches": s["config"]["question_batches_per_round"] - m["batches_asked"],
            })
            op = "interview.turn"
        self._enqueue(db, s, op, payload, member_id)

    def _maybe_detect(self, db, s):
        if s["phase"] == "interviewing" and all(
                m["approved_round"] == s["discussion_round"] for m in s["members"].values()):
            s["phase"] = "detecting_difference"
            self._enqueue(db, s, "negotiate.detect", {**self._base_payload(s), "shared_context": self._shared(s)})

    def _followup(self, s, trigger, review=None):
        return {"trigger": trigger, "difference": copy.deepcopy(s["difference"]),
                "answers": list(copy.deepcopy(s["answers"]).values()), "review": review}

    def _event_revision(self, s, member_id, event):
        kind, p = event["type"], event["payload"]
        if kind in ("interview.answer", "profile.approve"):
            return s["members"][member_id]["revision"]
        if kind == "difference.answer":
            return s["answer_revisions"].get(member_id, 0)
        if kind == "convergence.vote":
            return s["vote_revisions"].get(member_id, 0)
        key = p["candidate_ref"]["id"] + ":" + member_id
        return s["review_revisions"].get(key, 0)

    def submit(self, token, event):
        protocol.EVENT.validate(event)
        with self.store.transaction() as db:
            actor = self._auth(db, token, event["room_id"])
            need(actor["role"] == "member", "Only authenticated members submit human events", "UNAUTHORIZED")
            member_id = actor["member_id"]
            s = self._room(db, event["room_id"])
            existing = db.execute("SELECT * FROM events WHERE room_id=? AND event_id=?",
                                  (s["room_id"], event["event_id"])).fetchone()
            fingerprint = digest(event)
            if existing:
                need(existing["actor"] == member_id and existing["fingerprint"] == fingerprint,
                     "Event ID already used for different input", "CONFLICT")
                return json.loads(existing["result"])
            current = self._event_revision(s, member_id, event)
            db.execute("SAVEPOINT human_event")
            try:
                need(s["phase"] not in ("completed", "ended"), "Room has ended", "STALE_INPUT")
                need(event["expected_revision"] == current, "Input changed; refresh first", "STALE_INPUT")
                self._apply_event(db, s, member_id, event)
                Store.save(db, s)
                result = {"event_id": event["event_id"], "status": "accepted",
                          "current_revision": self._event_revision(s, member_id, event)}
                db.execute("RELEASE human_event")
            except WorkflowError as error:
                # Handlers validate first. Roll back any queued tasks before persisting rejection.
                db.execute("ROLLBACK TO human_event")
                db.execute("RELEASE human_event")
                s = self._room(db, event["room_id"])
                result = {"event_id": event["event_id"], "status": "rejected",
                          "current_revision": self._event_revision(s, member_id, event),
                          "error": {"code": error.code, "message": error.message}}
            db.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?)",
                       (s["room_id"], event["event_id"], member_id, fingerprint, encode(result), encode(event), now()))
            return result

    def _apply_event(self, db, s, member_id, event):
        p, kind = event["payload"], event["type"]
        m = s["members"][member_id]
        if kind == "interview.answer":
            need(s["phase"] == "interviewing" and m["stage"] == "awaiting_answers",
                 "No current question batch", "STALE_INPUT")
            batch = m["question_batch"]
            need(p["session_ref"] == m["session_ref"] and p["question_batch_ref"] == batch["question_batch_ref"],
                 "Question batch changed", "STALE_INPUT")
            keys = [a["question_key"] for a in p["answers"]]
            need(len(set(keys)) == len(keys) and set(keys) == {q["question_key"] for q in batch["questions"]},
                 "Answer every question once, or explicitly decline")
            need(all(a["declined"] or a["text"].strip() for a in p["answers"]), "Empty answer")
            questions = {q["question_key"]: q["text"] for q in batch["questions"]}
            for answer in p["answers"]:
                answer_text = "[declined]" if answer["declined"] else answer["text"]
                m["messages"].append({"message_id": uid("message"), "role": "user",
                                      "content": questions[answer["question_key"]] + "\nAnswer: " + answer_text})
            m["revision"] += 1
            m["question_batch"] = None
            m["interview_turn"] += 1
            self._queue_interview(db, s, member_id)
        elif kind == "profile.approve":
            need(s["phase"] == "interviewing" and m["stage"] == "awaiting_profile_approval",
                 "No current draft", "STALE_INPUT")
            need(p["draft_ref"] == m["draft"]["draft_ref"], "Draft changed", "STALE_INPUT")
            keys = [i["item_key"] for i in p["items"]]
            draft_keys = {i["item_key"] for i in m["draft"]["content"]["items"]}
            need(len(keys) == len(set(keys)) and set(keys) <= draft_keys, "Unknown or repeated draft item")
            previous = m["profile"]
            profile_ref = ref(previous["profile_ref"]["id"], previous["profile_ref"]["version"] + 1) if previous else ref(uid("profile"))
            items = []
            for item in p["items"]:
                source_id = self._source(s, "profile_item", profile_ref, item["text"], member_id)
                items.append({k: item[k] for k in ("category", "text", "basis", "confidence")} |
                             {"item_id": uid("item"), "source_id": source_id})
            m["profile"] = {"profile_ref": profile_ref, "member_id": member_id, "items": items,
                            "unknowns": p["unknowns"]}
            m["approved_at"] = now()
            m["approved_round"] = s["discussion_round"]
            m["stage"], m["revision"] = "approved", m["revision"] + 1
            self._maybe_detect(db, s)
        elif kind == "difference.answer":
            need(s["phase"] == "awaiting_difference_answers", "Not accepting answers", "STALE_INPUT")
            diff = s["difference"]
            need(p["difference_ref"] == diff["difference_ref"], "Difference changed", "STALE_INPUT")
            need(member_id in diff["content"]["affected_member_ids"], "Not a requested respondent", "UNAUTHORIZED")
            content = diff["content"]
            option = p["selected_option_key"]
            if p["disagrees_with_framing"]:
                need(bool(p["text"].strip()), "Explain the incorrect framing")
                need(option is None or option in {o["key"] for o in content["options"]}, "Unknown option")
            elif content["answer_type"] == "binary":
                need(option in {o["key"] for o in content["options"]}, "Choose a valid option")
            else:
                need(option is None and bool(p["text"].strip()), "Open answer requires text, not an option")
            answer = {"answer_ref": ref(uid("answer")), "member_id": member_id, **p}
            s["answers"][member_id] = answer
            s["answer_revisions"][member_id] = s["answer_revisions"].get(member_id, 0) + 1
            self._source(s, "difference_answer", answer["answer_ref"], encode(p), member_id)
            if set(s["answers"]) >= set(content["affected_member_ids"]):
                if s["discussion_round"] <= 3:
                    followup = self._followup(s, "difference_answers")
                    self._begin_round(db, s, "followup", followup)
                else:
                    s["phase"] = "awaiting_convergence_decision"
        elif kind == "convergence.vote":
            need(s["phase"] == "awaiting_convergence_decision", "Not accepting convergence votes", "STALE_INPUT")
            need(p["discussion_round"] == s["discussion_round"] and
                 p["difference_ref"] == s["difference"]["difference_ref"], "Discussion changed", "STALE_INPUT")
            s["votes"][member_id] = {"member_id": member_id, **p}
            s["vote_revisions"][member_id] = s["vote_revisions"].get(member_id, 0) + 1
            if p["decision"] == "diverge":
                self._source(s, "convergence_decision", ref(uid("diverge")), encode(s["votes"]), member_id)
                followup = self._followup(s, "human_diverge")
                self._begin_round(db, s, "followup", followup)
            elif set(s["votes"]) == set(s["members"]):
                decision_ref = ref(uid("convergence"))
                sid = self._source(s, "convergence_decision", decision_ref, encode(s["votes"]))
                s["convergence_decision"] = {"decision_ref": decision_ref, "discussion_round": s["discussion_round"],
                                            "decision": "converge", "source_ids": [sid]}
                s["phase"] = "idea_generating"
                self._enqueue(db, s, "idea.generate", {
                    **self._base_payload(s), "shared_context": self._shared(s),
                    "convergence_decision": s["convergence_decision"],
                    "candidate_slots": [uid("slot") for _ in range(s["config"]["candidate_count"])],
                })
        elif kind == "candidate.review":
            self._review(db, s, member_id, p)

    def _review(self, db, s, member_id, p):
        need(s["phase"] == "awaiting_review", "Not accepting candidate reviews", "STALE_INPUT")
        cid = p["candidate_ref"]["id"]
        need(cid in s["candidates"] and s["candidates"][cid]["candidate_ref"] == p["candidate_ref"],
             "Candidate changed", "STALE_INPUT")
        need(s["evaluations"][cid]["evaluation_ref"] == p["evaluation_ref"], "Evaluation changed", "STALE_INPUT")
        if p["decision"] != "accept":
            need(bool(p["instructions"].strip()), "Explain the requested revision or discussion")
        review = {"review_ref": ref(uid("review")), "member_id": member_id, **p}
        reviews = s["reviews"].setdefault(cid, {})
        reviews[member_id] = review
        key = cid + ":" + member_id
        s["review_revisions"][key] = s["review_revisions"].get(key, 0) + 1
        self._source(s, "human_review", review["review_ref"], encode(p), member_id)
        if set(reviews) != set(s["members"]):
            return
        decisions = {r["decision"] for r in reviews.values()}
        if len(decisions) != 1:
            return  # Keep human disagreement visible; users can amend their own reviews.
        decision = next(iter(decisions))
        if decision == "accept":
            s["selected_candidate_ref"] = p["candidate_ref"]
            s["phase"] = "completed"
        elif decision == "minor_revision":
            if len({r["instructions"].strip() for r in reviews.values()}) != 1:
                return  # Workflow does not ask the model to resolve conflicting instructions.
            s["phase"] = "revising"
            self._enqueue(db, s, "idea.revise", {**self._base_payload(s), "shared_context": self._shared(s),
                          "candidate": s["candidates"][cid], "evaluation": s["evaluations"][cid],
                          "reviews": list(reviews.values())}, candidate_id=cid)
        elif decision == "more_discussion":
            s["candidate_history"].append({"candidates": s["candidates"], "evaluations": s["evaluations"],
                                           "reviews": s["reviews"]})
            # All reviews are in shared history; singular triggering review is carried for v2 compatibility.
            followup = self._followup(s, "review_more_discussion", review)
            s["candidates"], s["evaluations"], s["reviews"] = {}, {}, {}
            self._begin_round(db, s, "reopened", followup)

    def _matches(self, s, row):
        saved = json.loads(row["dependencies"])
        candidate_id = saved.pop("candidate_id")
        return saved == self._dependencies(s, row["operation"], row["member_id"], candidate_id)

    def claim(self, room_id=None):
        with self.store.transaction() as db:
            rows = db.execute("""SELECT * FROM tasks
                WHERE (status='queued' OR (status='running' AND lease_until < ?))
                AND (? IS NULL OR room_id=?) ORDER BY created_at,id""", (time.time(), room_id, room_id)).fetchall()
            for row in rows:
                s = self._room(db, row["room_id"])
                if not self._matches(s, row):
                    db.execute("UPDATE tasks SET status='stale',lease_token=NULL WHERE id=?", (row["id"],))
                    continue
                if s["mode"] != self.runner.mode or s["paused_reason"]:
                    continue
                if s["calls_started"] >= s["config"]["max_agent_calls"]:
                    s["paused_reason"] = "agent_budget"
                    Store.save(db, s)
                    continue
                lease = uid("lease")
                db.execute("""UPDATE tasks SET status='running', attempts=attempts+1,
                    lease_token=?,lease_until=? WHERE id=?""", (lease, time.time() + self.lease_seconds, row["id"]))
                s["calls_started"] += 1
                Store.save(db, s)
                return {"task_id": row["id"], "lease_token": lease, "request": json.loads(row["request"])}
        return None

    def run_once(self, room_id=None):
        claim = self.claim(room_id)
        if claim is None:
            return False
        try:
            response = self.runner(copy.deepcopy(claim["request"]))
            protocol.check_response(claim["request"], response)
        except Exception:
            response = {**{k: claim["request"][k] for k in
                           ("schema_version", "request_id", "room_id", "operation", "input_revision")},
                        "status": "error", "data": {}, "warnings": [],
                        "error": {"code": "MODEL_ERROR", "message": "Agent failed validation or execution",
                                  "retryable": True}}
        self.finish(claim["task_id"], claim["lease_token"], response)
        return True

    def finish(self, task_id, lease_token, response):
        with self.store.transaction() as db:
            row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
            if row is None or row["status"] != "running" or row["lease_token"] != lease_token:
                return False
            s = self._room(db, row["room_id"])
            if not self._matches(s, row):
                db.execute("UPDATE tasks SET status='stale',lease_token=NULL WHERE id=?", (task_id,))
                return False
            request = json.loads(row["request"])
            try:
                protocol.check_response(request, response)
            except Exception:
                db.execute("UPDATE tasks SET status='failed',error=?,lease_token=NULL WHERE id=?",
                           (encode({"code": "INVALID_OUTPUT", "message": "Agent response rejected"}), task_id))
                return False
            if response["status"] == "error":
                # Never copy raw provider messages or private payloads into visible task errors.
                error = {"code": response["error"]["code"], "message": "Agent task failed; retry or check server configuration"}
                db.execute("UPDATE tasks SET status='failed',error=?,result=?,lease_token=NULL WHERE id=?",
                           (encode(error), encode(response), task_id))
                return False
            self._apply_result(db, s, request, response["data"], row["member_id"])
            db.execute("UPDATE tasks SET status='done',result=?,error=NULL,lease_token=NULL WHERE id=?",
                       (encode(response), task_id))
            Store.save(db, s)
            return True

    def _apply_result(self, db, s, request, data, member_id):
        op = request["operation"]
        if op == "interview.turn":
            m = s["members"][member_id]
            m["revision"] += 1
            if data["ready_to_summarize"]:
                self._queue_interview(db, s, member_id, summarize=True, stop_reason=data["stop_reason"])
            else:
                m["stage"] = "awaiting_answers"
                m["question_batch"] = {"question_batch_ref": ref(uid("questions")), "questions": data["questions"]}
                m["batches_asked"] += 1
                for question in data["questions"]:
                    m["messages"].append({"message_id": uid("message"), "role": "assistant", "content": question["text"]})
        elif op == "interview.summarize":
            m = s["members"][member_id]
            m["revision"] += 1
            m["stage"] = "awaiting_profile_approval"
            m["draft"] = {"draft_ref": ref(uid("draft")), "content": data["profile_draft"]}
        elif op == "negotiate.detect":
            s["difference"] = {"difference_ref": ref(uid("difference")), "discussion_round": s["discussion_round"],
                               "content": data["difference"]}
            self._source(s, "difference", s["difference"]["difference_ref"], encode(data["difference"]))
            s["answers"], s["votes"] = {}, {}
            s["answer_revisions"], s["vote_revisions"] = {}, {}
            s["phase"] = "awaiting_difference_answers"
        elif op == "idea.generate":
            s["candidates"], s["evaluations"], s["reviews"], s["review_revisions"] = {}, {}, {}, {}
            s["phase"] = "evaluating"
            for entry in data["candidates"]:
                candidate_id = uid("candidate")
                s["candidates"][candidate_id] = {"candidate_ref": ref(candidate_id), "content": entry["draft"]}
                self._queue_evaluation(db, s, candidate_id)
        elif op == "idea.revise":
            cid = data["base_candidate_ref"]["id"]
            old = s["candidates"][cid]
            s["candidate_history"].append({"candidates": {cid: copy.deepcopy(old)},
                                           "evaluations": {cid: copy.deepcopy(s["evaluations"][cid])},
                                           "reviews": {cid: copy.deepcopy(s["reviews"][cid])}})
            s["candidates"][cid] = {"candidate_ref": ref(cid, old["candidate_ref"]["version"] + 1),
                                    "content": data["draft"]}
            s["evaluations"].pop(cid)
            s["reviews"][cid] = {}
            for member in s["members"]:
                s["review_revisions"][cid + ":" + member] = 0
            s["phase"] = "evaluating"
            self._queue_evaluation(db, s, cid)
        elif op == "evaluator.evaluate":
            report = data["evaluation"]
            cid = report["candidate_ref"]["id"]
            stored = {"evaluation_ref": ref(uid("evaluation")), "content": report}
            s["evaluations"][cid] = stored
            self._source(s, "evaluation", stored["evaluation_ref"], encode(report))
            if set(s["evaluations"]) == set(s["candidates"]):
                s["phase"] = "awaiting_review"

    def _queue_evaluation(self, db, s, candidate_id):
        candidate = s["candidates"][candidate_id]
        # Candidate evidence references are the minimal context required by this call.
        needed = set(candidate["content"]["discussion_source_ids"])
        for contribution in candidate["content"]["contributions"]:
            needed.update(contribution["source_ids"])
        self._enqueue(db, s, "evaluator.evaluate", {**self._base_payload(s), "candidate": candidate,
            "shared_sources": [x for x in s["sources"] if x["source_id"] in needed],
            "search_policy": {"enabled": s["config"]["search_enabled"],
                              "max_queries": s["config"]["max_search_queries"]},
            "provided_evidence": []}, candidate_id=candidate_id)

    def retry(self, token, room_id, task_id):
        with self.store.transaction() as db:
            actor = self._auth(db, token, room_id)
            s = self._room(db, room_id)
            row = db.execute("SELECT * FROM tasks WHERE id=? AND room_id=?", (task_id, room_id)).fetchone()
            need(row is not None, "Task not found")
            need(actor["role"] == "admin" or row["member_id"] is None or row["member_id"] == actor["member_id"],
                 "Private task belongs to another member", "UNAUTHORIZED")
            need(row["status"] == "failed" and self._matches(s, row), "Task cannot be retried", "STALE_INPUT")
            db.execute("UPDATE tasks SET status='queued',error=NULL,result=NULL WHERE id=?", (task_id,))
            return {"task_id": task_id, "status": "queued"}

    def increase_budget(self, token, room_id, max_agent_calls):
        need(type(max_agent_calls) is int, "Budget must be integer")
        with self.store.transaction() as db:
            self._auth(db, token, room_id, admin=True)
            s = self._room(db, room_id)
            need(s["config"]["max_agent_calls"] < max_agent_calls <= 10000, "Budget must increase, at most 10000")
            s["config"]["max_agent_calls"] = max_agent_calls
            s["paused_reason"] = None
            Store.save(db, s)
            return {"max_agent_calls": max_agent_calls}

    def stop(self, token, room_id):
        with self.store.transaction() as db:
            self._auth(db, token, room_id, admin=True)
            s = self._room(db, room_id)
            need(s["phase"] != "completed", "Completed output already recorded", "CONFLICT")
            s["phase"] = "ended"
            db.execute("UPDATE tasks SET status='cancelled',lease_token=NULL WHERE room_id=? AND status IN ('queued','running')",
                       (room_id,))
            Store.save(db, s)
            return {"phase": "ended"}

    def view(self, token, room_id):
        with self.store.transaction() as db:
            actor = self._auth(db, token, room_id)
            s = self._room(db, room_id)
            member_id = actor["member_id"]
            tasks = db.execute("""SELECT id,member_id,operation,status,attempts,error FROM tasks
                                   WHERE room_id=? ORDER BY created_at,id""", (room_id,)).fetchall()
            public = {key: copy.deepcopy(s[key]) for key in (
                "room_id", "revision", "discussion_round", "phase", "mode", "room_context", "config",
                "paused_reason", "calls_started", "difference", "answers", "votes", "convergence_decision",
                "candidates", "evaluations", "reviews", "candidate_history", "selected_candidate_ref",
            )}
            public["shared_context"] = copy.deepcopy(self._shared(s))
            public["members"] = {mid: {"stage": m["stage"], "approved_round": m["approved_round"]}
                                 for mid, m in s["members"].items()}
            public["tasks"] = [
                {"task_id": t["id"], "operation": t["operation"], "status": t["status"], "attempts": t["attempts"],
                 "member_id": t["member_id"], "error": json.loads(t["error"]) if t["error"] else None}
                for t in tasks if t["member_id"] is None or t["member_id"] == member_id or actor["role"] == "admin"
            ]
            public["actor"] = {"role": actor["role"], "member_id": member_id}
            public["private"] = None
            public["event_revisions"] = None
            if member_id:
                m = s["members"][member_id]
                public["private"] = {key: copy.deepcopy(m[key]) for key in (
                    "revision", "session_ref", "stage", "messages", "question_batch", "draft", "mode",
                    "interview_turn", "batches_asked",
                )}
                public["event_revisions"] = {
                    "interview": m["revision"], "difference": s["answer_revisions"].get(member_id, 0),
                    "convergence": s["vote_revisions"].get(member_id, 0),
                    "review": {cid: s["review_revisions"].get(cid + ":" + member_id, 0) for cid in s["candidates"]},
                }
            if s["selected_candidate_ref"]:
                cid = s["selected_candidate_ref"]["id"]
                public["final_output"] = {"candidate": s["candidates"][cid], "evaluation": s["evaluations"][cid],
                                          "human_reviews": list(s["reviews"][cid].values())}
            else:
                public["final_output"] = None
            return public
