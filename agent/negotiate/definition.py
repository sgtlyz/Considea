"""Python entry for negotiate.detect.

Workflow:

    from agent.negotiate.definition import handle_request
    response = handle_request(request)

Or, from the repository root, one JSON request per line:

    python -m agent.negotiate
"""

import json
import sys

from .detect import detect_difference
from .prompt import OUTPUT_INSTRUCTIONS, SYSTEM_PROMPT
from .validate import (
    ContractError,
    assert_detect_input,
    assert_envelope,
    envelope_headers,
    validate_detect_data,
    validate_detect_input,
)

DEFINITION = {
    "name": "negotiate",
    "system_prompt": SYSTEM_PROMPT,
    "operations": {
        "negotiate.detect": {
            "validate_input": validate_detect_input,
            "validate_output": validate_detect_data,
            "output_instructions": OUTPUT_INSTRUCTIONS,
        },
    },
}


def error_response(request, code, message, retryable=False):
    return {
        **envelope_headers(request),
        "status": "error",
        "data": {},
        "warnings": [],
        "error": {"code": code, "message": message, "retryable": retryable},
    }


def handle_request(request, complete=None):
    """Validate one envelope, run negotiate.detect, and return the v2 response."""
    try:
        assert_envelope(request)
        assert_detect_input(request["payload"])
    except ContractError as error:
        return error_response(request, "INVALID_INPUT", str(error))
    try:
        result = detect_difference(request["payload"], complete=complete)
    except ContractError as error:
        return error_response(request, "INVALID_OUTPUT", str(error))
    return {**envelope_headers(request), **result, "error": None}


def main(stdin=None, stdout=None):
    reader = sys.stdin if stdin is None else stdin
    writer = sys.stdout if stdout is None else stdout
    for line in reader:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            response = error_response({}, "INVALID_INPUT", "Request line is not JSON")
        else:
            response = handle_request(request) if isinstance(request, dict) else error_response(
                {}, "INVALID_INPUT", "request must be an object",
            )
        writer.write(json.dumps(response, ensure_ascii=False) + "\n")
        writer.flush()
