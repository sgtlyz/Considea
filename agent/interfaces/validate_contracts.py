"""Offline protocol checks; no model, network, workflow, or database execution."""
import copy
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker, ValidationError

ROOT = Path(__file__).resolve().parent
SCHEMA = json.loads((ROOT / "protocol.schema.json").read_text(encoding="utf-8"))
Draft202012Validator.check_schema(SCHEMA)
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
HEADERS = ("schema_version", "request_id", "room_id", "operation", "input_revision")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique(values, name):
    require(len(values) == len(set(values)), f"Duplicate {name}")


def source_refs(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key.endswith("source_ids"):
                yield from child
            elif key == "source_id" and child is not None:
                yield child
            else:
                yield from source_refs(child)
    elif isinstance(value, list):
        for item in value:
            yield from source_refs(item)


def check_pair(pair):
    request, response = pair["request"], pair["response"]
    VALIDATOR.validate(request)
    VALIDATOR.validate(response)
    for key in HEADERS:
        require(request[key] == response[key], f"Response header mismatch: {key}")
    p = request["payload"]
    d = response["data"]
    op = request["operation"]
    members = set(p["room_context"]["member_ids"])
    shared = p.get("shared_context")
    sources = (shared or {}).get("sources", p.get("shared_sources", []))
    unique([s["source_id"] for s in sources], "source IDs")
    source_map = {s["source_id"]: s for s in sources}
    allowed = set(source_map)
    if shared:
        for sid in source_refs({"profiles": shared["profiles"], "history": shared["discussion_history"]}):
            require(sid in allowed, f"Unresolved input source: {sid}")
        for profile in shared["profiles"]:
            require(profile["member_id"] in members, "Profile belongs to unknown member")
        if "convergence_decision" in p:
            decision = p["convergence_decision"]
            require(decision["discussion_round"] == p["discussion_round"], "Convergence round mismatch")
            for sid in decision["source_ids"]:
                require(sid in allowed, "Missing human convergence source")
                require(source_map[sid]["kind"] == "convergence_decision", "Wrong convergence source kind")
                require(source_map[sid]["object_ref"] == decision["decision_ref"], "Wrong convergence decision ref")
    if "member_id" in p:
        require(p["member_id"] in members, "Unknown interview member")
        if p["current_profile"] is not None:
            require(p["current_profile"]["member_id"] == p["member_id"], "Another member's profile")
        followup = p["followup_context"]
        if followup is not None:
            diff = followup["difference"]
            require(all(a["difference_ref"] == diff["difference_ref"] for a in followup["answers"]),
                    "Answer for wrong difference")
            require(all(a["member_id"] in members for a in followup["answers"]), "Unknown answer author")
            if p["mode"] == "reopened":
                require(followup["trigger"] == "review_more_discussion" and
                        followup["review"] is not None and followup["review"]["decision"] == "more_discussion",
                        "Reopened interview lacks human review")
    if response["status"] == "error":
        return
    for sid in source_refs(d):
        require(sid in allowed, f"Unresolved output source: {sid}")
    if op.startswith("interview."):
        require(d["member_id"] == p["member_id"], "Interview output member mismatch")
    if op == "interview.turn":
        unique([q["question_key"] for q in d["questions"]], "question keys")
        require(len(d["questions"]) <= p["limits"]["max_questions"], "Too many questions")
        if p["limits"]["remaining_question_batches"] == 0:
            require(not d["questions"] and d["stop_reason"] == "question_budget", "Question budget ignored")
    if op == "interview.summarize":
        items = d["profile_draft"]["items"]
        unique([i["item_key"] for i in items], "profile item keys")
        private_ids = {m["message_id"] for m in p["messages"]}
        for item in items:
            require(set(item["private_message_ids"]) <= private_ids, "Unknown private evidence")
    if op == "negotiate.detect":
        difference = d["difference"]
        require(set(difference["affected_member_ids"]) <= members, "Unknown affected member")
        unique([o["key"] for o in difference["options"]], "answer option keys")
    drafts = []
    if op == "idea.generate":
        slots = [c["slot_id"] for c in d["candidates"]]
        unique(slots, "candidate slots")
        require(set(slots) == set(p["candidate_slots"]), "Missing or extra candidate slot")
        drafts = [c["draft"] for c in d["candidates"]]
    if op == "idea.revise":
        target = p["candidate"]["candidate_ref"]
        require(d["base_candidate_ref"] == target, "Stale revision base")
        require(p["evaluation"]["content"]["candidate_ref"] == target, "Evaluation candidate mismatch")
        for review in p["reviews"]:
            require(review["decision"] == "minor_revision" and review["instructions"].strip(),
                    "Revision lacks actual instructions")
            require(review["candidate_ref"] == target, "Review candidate mismatch")
            require(review["evaluation_ref"] == p["evaluation"]["evaluation_ref"], "Review evaluation mismatch")
        require(d["draft"]["change_summary"].strip(), "Missing change summary")
        drafts = [d["draft"]]
    for draft in drafts:
        unique([x["key"] for x in draft["critical_dependencies"]], "dependency keys")
        for c in draft["contributions"]:
            if c["origin"] == "member_input":
                require(c["source_ids"], "Unattributed member contribution")
    if op == "evaluator.evaluate":
        report = d["evaluation"]
        require(report["candidate_ref"] == p["candidate"]["candidate_ref"], "Stale evaluation target")
        evidence = report["evidence"]
        unique([e["evidence_key"] for e in evidence], "evidence keys")
        emap = {e["evidence_key"]: e for e in evidence}
        dependencies = {x["key"] for x in p["candidate"]["content"]["critical_dependencies"]}
        for finding in report["findings"]:
            require(finding["dependency_key"] is None or finding["dependency_key"] in dependencies,
                    "Unknown dependency")
            require(set(finding["evidence_keys"]) <= set(emap), "Missing finding evidence")
            kinds = {emap[k]["source_kind"] for k in finding["evidence_keys"]}
            if finding["conclusion"] == "verified":
                require("test_record" in kinds, "Verified without actual test-record evidence")
            if finding["conclusion"] == "supported_by_source":
                require(bool(kinds & {"official_documentation", "project_self_report"}),
                        "Supported without documentation evidence")
            if finding["conclusion"] == "team_claim":
                require("team_claim" in kinds, "Team claim lacks member evidence")
        for project in report["similar_projects"]:
            require(set(project["evidence_keys"]) <= set(emap), "Missing competitor evidence")
        for e in evidence:
            if e["source_kind"] == "team_claim":
                require(e["source_id"] in allowed, "Unattributed team evidence")
        if not p["search_policy"]["enabled"] or p["search_policy"]["max_queries"] == 0:
            require(all(q["result_status"] == "disabled" for q in report["search_log"]),
                    "Search performed while disabled")


def negatives(fixtures):
    cases = []
    def case(name, fixture_name, mutate):
        pair = copy.deepcopy(fixtures[fixture_name])
        mutate(pair)
        cases.append((name, pair))
    case("wrong response ID", "interview-turn", lambda x: x["response"].update(request_id="other"))
    case("old business version", "interview-turn", lambda x: x["request"]["payload"].update(contract_version="1.0"))
    case("forged approval", "interview-summary",
         lambda x: x["response"]["data"]["profile_draft"].update(approved_at="2026-10-04T00:00:00Z"))
    case("unknown private evidence", "interview-summary",
         lambda x: x["response"]["data"]["profile_draft"]["items"][0].update(private_message_ids=["other-person-msg"]))
    case("unknown shared source", "negotiate-difference",
         lambda x: x["response"]["data"]["difference"].update(source_ids=["not-authorized"]))
    case("unknown affected member", "negotiate-difference",
         lambda x: x["response"]["data"]["difference"].update(affected_member_ids=["outsider"]))
    case("budget ignored", "interview-turn",
         lambda x: x["request"]["payload"]["limits"].update(remaining_question_batches=0))
    case("duplicate candidate slot", "idea-generate",
         lambda x: x["response"]["data"]["candidates"][1].update(slot_id="slot-a"))
    case("generation round does not match the human decision", "idea-generate",
         lambda x: x["request"]["payload"].update(discussion_round=3))
    case("missing human converge", "idea-generate",
         lambda x: x["request"]["payload"].pop("convergence_decision"))
    case("stale candidate base", "idea-revise",
         lambda x: x["response"]["data"].update(base_candidate_ref={"id":"candidate-a","version":99}))
    case("stale evaluation", "evaluator-partial",
         lambda x: x["response"]["data"]["evaluation"].update(candidate_ref={"id":"candidate-a","version":99}))
    case("partial status mismatch", "evaluator-partial",
         lambda x: x["response"].update(status="ok"))
    case("fake verification", "evaluator-complete",
         lambda x: x["response"]["data"]["evaluation"]["findings"][0].update(conclusion="verified"))
    for name, pair in cases:
        try:
            check_pair(pair)
        except (ValueError, ValidationError):
            pass
        else:
            raise AssertionError(f"Invalid contract unexpectedly accepted: {name}")
    return len(cases)


def main():
    if sys.argv[1:]:
        for filename in sys.argv[1:]:
            check_pair(json.loads(Path(filename).read_text(encoding="utf-8")))
            print(f"Valid contract pair: {filename}")
        return
    pairs = {}
    for filename in sorted((ROOT / "fixtures").glob("*.json")):
        value = json.loads(filename.read_text(encoding="utf-8"))
        if isinstance(value, dict) and "request" in value:
            check_pair(value)
            pairs[filename.stem] = value
        elif isinstance(value, list):
            for item in value:
                VALIDATOR.validate(item)
        else:
            raise ValueError(f"Unknown fixture format: {filename}")
    failed_samples = negatives(pairs)
    event_count = len(json.loads((ROOT / "fixtures" / "human-events.json").read_text(encoding="utf-8")))
    result_count = len(json.loads((ROOT / "fixtures" / "human-event-results.json").read_text(encoding="utf-8")))
    print(f"PASS: {len(pairs)} request/response pairs, {event_count} human events, "
          f"{result_count} event results, {failed_samples} negative cases.")
    print("Offline contract checks only; no model, workflow or authorization implementation tested.")


if __name__ == "__main__":
    main()
