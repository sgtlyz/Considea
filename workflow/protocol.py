"""Frozen v2 shape and relationship checks, reused by the application boundary."""
import importlib.util
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
import json
import copy

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "agent/interfaces/protocol.schema.json").read_text(encoding="utf-8"))
def validator(name):
    return Draft202012Validator(
        {"$schema": SCHEMA["$schema"], "$ref": "#/$defs/" + name, "$defs": SCHEMA["$defs"]},
        format_checker=FormatChecker(),
    )

# Interview's explicit 2.1 extension; other operations and human events stay 2.0.
INTERVIEW_SCHEMA = copy.deepcopy(SCHEMA)
d = INTERVIEW_SCHEMA["$defs"]
def _ref(name): return {"$ref": "#/$defs/" + name}
def _nullable(value): return {"anyOf": [value, {"type": "null"}]}
def _object(props): return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}
d["InterviewDecisionResult"] = _object({
    "decision_ref": _ref("Ref"), "discussion_round": {"type": "integer", "minimum": 1},
    "decision": {"enum": ["continue_interview", "diverge"]},
    "conclusion": {"type": "string", "minLength": 1},
    "source_ids": {"type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1, "uniqueItems": True}})
d["InterviewEvaluation"] = _object({**d["StoredEvaluation"]["properties"], "feasibility": _object({
    "verdict": {"enum": ["feasible", "infeasible", "conditional", "unknown"]},
    "rationale": {"type": "string", "minLength": 1}})})
d["FollowupContext"] = _object({**d["FollowupContext"]["properties"],
    "difference": _nullable(_ref("StoredDifference")), "answers": {"type": "array", "items": _ref("Answer")},
    "decision_result": _nullable(_ref("InterviewDecisionResult")), "candidate": _nullable(_ref("Candidate")),
    "evaluation": _nullable(_ref("InterviewEvaluation"))})
for name in ("InterviewTurnInput", "InterviewSummarizeInput", "InterviewTurnData", "InterviewSummarizeData"):
    d[name]["properties"]["contract_version"] = {"const": "2.1"}
def interview_validator(name):
    return Draft202012Validator({"$schema": SCHEMA["$schema"], "$ref": "#/$defs/" + name,
                                "$defs": d}, format_checker=FormatChecker())
class RequestValidator:
    def validate(self, request):
        extended = request.get("operation", "").startswith("interview.") and request.get("payload", {}).get("contract_version") == "2.1"
        (interview_validator("Request") if extended else validator("Request")).validate(request)
REQUEST = RequestValidator()
EVENT = validator("ClientEvent")
ROOM_CONTEXT = validator("RoomContext")
_spec = importlib.util.spec_from_file_location(
    "conclave_contract_checks", ROOT / "agent/interfaces/validate_contracts.py"
)
_checks = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_checks)


def check_response(request, response):
    if request["operation"].startswith("interview.") and request["payload"]["contract_version"] == "2.1":
        REQUEST.validate(request)
        interview_validator("Response").validate(response)
        # Reuse the existing ownership, source and output relationship checks.
        base_request, base_response = copy.deepcopy(request), copy.deepcopy(response)
        base_request["payload"]["contract_version"] = "2.0"
        if base_request["payload"]["followup_context"]:
            for key in ("decision_result", "candidate", "evaluation"):
                base_request["payload"]["followup_context"].pop(key)
        if response["status"] != "error": base_response["data"]["contract_version"] = "2.0"
        _checks.check_pair({"request": base_request, "response": base_response})
    else:
        _checks.check_pair({"request": request, "response": response})
    if response["status"] == "error":
        return
    if request["operation"] == "evaluator.evaluate":
        p = request["payload"]
        report = response["data"]["evaluation"]
        keys = [f["finding_key"] for f in report["findings"]]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate finding keys")
        enabled = p["search_policy"]["enabled"]
        queries = [q for q in report["search_log"] if q["result_status"] != "disabled"]
        if enabled and len(queries) > p["search_policy"]["max_queries"]:
            raise ValueError("Search budget exceeded")
        # In v2 the worker returns no independently authenticated tool receipts.
        # Test verification must therefore be supplied by the trusted workflow.
        tests = {e["evidence_key"]: e for e in p["provided_evidence"] if e["source_kind"] == "test_record"}
        evidence = {e["evidence_key"]: e for e in report["evidence"]}
        for finding in report["findings"]:
            if finding["conclusion"] == "verified":
                if not any(k in tests and evidence.get(k) == tests[k] for k in finding["evidence_keys"]):
                    raise ValueError("Untrusted test verification")
