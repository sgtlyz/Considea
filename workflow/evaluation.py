"""Trusted evaluator transport metadata; the other Agent contracts stay at v2."""
from dataclasses import dataclass
from jsonschema import Draft202012Validator, FormatChecker

TIME_LIMIT = Draft202012Validator({"oneOf": [
    {"type": "object", "properties": {"kind": {"const": "none"}}, "required": ["kind"], "additionalProperties": False},
    {"type": "object", "properties": {"kind": {"const": "duration"}, "hours": {"type": "number", "exclusiveMinimum": 0, "maximum": 87600}},
     "required": ["kind", "hours"], "additionalProperties": False},
    {"type": "object", "properties": {"kind": {"const": "deadline"}, "deadline_at": {"type": "string", "format": "date-time"}},
     "required": ["kind", "deadline_at"], "additionalProperties": False},
]}, format_checker=FormatChecker())


@dataclass
class EvaluationResult:
    # This is an internal runner return type, never a model-writable envelope extension.
    response: dict
    report: dict | None = None


def time_limit(state):
    limit = state["config"].get("project_time_limit")
    if limit is not None:
        return limit
    deadline = state["room_context"]["deadline_at"]
    return {"kind": "deadline", "deadline_at": deadline} if deadline else None


def resources(state, profiles=None):
    if profiles is None:
        profiles = [{**m["profile"], "member_id": mid} for mid, m in state["members"].items() if m["profile"]]
    return [{"profile_id": profile["profile_ref"]["id"], "profile_version": profile["profile_ref"]["version"],
             "item_id": item["item_id"], "member_id": profile["member_id"], "category": item["category"], "text": item["text"], "source_id": item["source_id"]}
            for profile in profiles
            for item in profile["items"] if item["category"] in ("skill", "resource") and item["basis"] == "member_statement"]


def check_report(request, report):
    # Full report/evidence validation occurs in the trusted Node adapter before transport.
    # Recheck the identity and server-computed verdict before attaching it to a room version.
    candidate = request["payload"]["candidate"]["candidate_ref"]
    if (request["operation"] != "evaluator.evaluate" or not isinstance(report, dict)
            or report.get("report_schema_version") != "1.2" or report.get("candidate_id") != candidate["id"]
            or report.get("candidate_version") != candidate["version"] or report.get("version") != candidate["version"]):
        raise ValueError("Mismatched native evaluator report")
    tests = report.get("tests", {})
    if set(tests) != {"novelty", "feasibility"} or any(t.get("result") not in ("pass", "fail", "insufficient_evidence") for t in tests.values()):
        raise ValueError("Invalid evaluator verdicts")
    if report.get("passed") is not all(t["result"] == "pass" for t in tests.values()):
        raise ValueError("Invalid aggregate verdict")
