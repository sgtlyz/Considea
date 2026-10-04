"""Internal workflow bridge. NODE_BIN and the environment are trusted deployment configuration."""
import json
import os
from pathlib import Path
import subprocess


def _error(request, code, message, retryable=False):
    headers = {k: request.get(k) if isinstance(request, dict) else None for k in
               ("schema_version", "request_id", "room_id", "operation", "input_revision")}
    return {**headers, "status": "error", "data": {}, "warnings": [],
            "error": {"code": code, "message": message, "retryable": retryable}}


def run_evaluator(request, *, timeout=None, fixture=False):
    """Return the Evaluator envelope; never writes workflow state or performs automatic retries."""
    if timeout is None:
        payload = request.get("payload", {}) if isinstance(request, dict) else {}
        budget = payload.get("tool_budget", {}) if isinstance(payload, dict) else {}
        milliseconds = budget.get("timeout_ms", 60000) if isinstance(budget, dict) else 60000
        timeout = min(milliseconds / 1000 + 10, 190) if isinstance(milliseconds, (int, float)) and milliseconds > 0 else 70
    command = [os.environ.get("NODE_BIN", "node"), str(Path(__file__).with_name("cli.mjs"))]
    if fixture:
        command.append("--fixture")
    try:
        process = subprocess.run(command, input=json.dumps(request, ensure_ascii=False) + "\n",
                                 capture_output=True, text=True, encoding="utf-8", timeout=timeout,
                                 env={**os.environ, "PYTHONIOENCODING": "utf-8"}, check=False,
                                 **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))
        lines = [line for line in process.stdout.splitlines() if line.strip()]
        if process.returncode != 0 or len(lines) != 1:
            return _error(request, "BRIDGE_ERROR", "Evaluator subprocess failed", True)
        result = json.loads(lines[0])
        if not isinstance(result, dict) or result.get("status") not in ("ok", "partial", "needs_input", "error"):
            return _error(request, "BRIDGE_ERROR", "Invalid evaluator response")
        if any(result.get(k) != request.get(k) for k in
               ("request_id", "room_id", "operation", "input_revision")):
            return _error(request, "BRIDGE_ERROR", "Evaluator response identity mismatch")
        return result
    except subprocess.TimeoutExpired:
        return _error(request, "MODEL_TIMEOUT", "Evaluator subprocess exceeded its deadline", True)
    except (OSError, ValueError, TypeError, AttributeError):
        return _error(request, "BRIDGE_ERROR", "Unable to run evaluator subprocess", True)
