"""Frozen v2 shape and relationship checks, reused by the application boundary."""
import importlib.util
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
import json

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "agent/interfaces/protocol.schema.json").read_text(encoding="utf-8"))
def validator(name):
    return Draft202012Validator(
        {"$schema": SCHEMA["$schema"], "$ref": "#/$defs/" + name, "$defs": SCHEMA["$defs"]},
        format_checker=FormatChecker(),
    )

REQUEST = validator("Request")
EVENT = validator("ClientEvent")
ROOM_CONTEXT = validator("RoomContext")
_spec = importlib.util.spec_from_file_location(
    "conclave_contract_checks", ROOT / "agent/interfaces/validate_contracts.py"
)
_checks = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_checks)


def check_response(request, response):
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
