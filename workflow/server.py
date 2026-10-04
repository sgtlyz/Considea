"""Small local HTTP application and worker pool, using only stdlib + jsonschema."""
import argparse
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from jsonschema import ValidationError
from .agents import MockRunner, PiRunner
from .engine import Workflow, WorkflowError
from .store import Store


def make_server(workflow, host="127.0.0.1", port=8765):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Do not log invitation bodies or credentials.

        def _send(self, status, data, content_type="application/json; charset=utf-8"):
            body = (json.dumps(data, ensure_ascii=False).encode("utf-8")
                    if content_type.startswith("application/json") else data)
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def _token(self):
            value = self.headers.get("Authorization", "")
            if not value.startswith("Bearer ") or not value[7:]:
                raise WorkflowError("UNAUTHORIZED", "Bearer token required", 401)
            return value[7:]

        def _body(self):
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise WorkflowError("INVALID_INPUT", "Content-Type must be application/json")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise WorkflowError("INVALID_INPUT", "Invalid Content-Length")
            if not 0 < length <= 1_048_576:
                raise WorkflowError("INVALID_INPUT", "Body must be between 1 byte and 1 MiB")
            try:
                body = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError):
                raise WorkflowError("INVALID_INPUT", "Expected JSON")
            if not isinstance(body, dict):
                raise WorkflowError("INVALID_INPUT", "Expected JSON object")
            return body

        def _dispatch(self, method):
            parts = [p for p in urlsplit(self.path).path.split("/") if p]
            try:
                if method == "GET" and not parts:
                    html = (Path(__file__).parent / "web/index.html").read_bytes()
                    return self._send(200, html, "text/html; charset=utf-8")
                if method == "GET" and parts == ["api", "health"]:
                    return self._send(200, {"status": "ok", "agent_mode": workflow.runner.mode})
                if parts == ["api", "rooms"] and method == "POST":
                    body = self._body()
                    return self._send(201, workflow.create_room(body["room_context"], body.get("config")))
                if len(parts) >= 3 and parts[:2] == ["api", "rooms"]:
                    rid = parts[2]
                    if len(parts) == 4 and parts[3] == "join" and method == "POST":
                        body = self._body()
                        return self._send(200, workflow.join(rid, body["invitation"]))
                    token = self._token()
                    if len(parts) == 3 and method == "GET":
                        return self._send(200, workflow.view(token, rid))
                    if method == "POST":
                        body = self._body()
                        if parts[3:] == ["events"]:
                            if body.get("room_id") != rid:
                                raise WorkflowError("INVALID_INPUT", "Room ID mismatch")
                            result = workflow.submit(token, body)
                            return self._send(200 if result["status"] == "accepted" else 409, result)
                        if parts[3:] == ["budget"]:
                            return self._send(200, workflow.increase_budget(token, rid, body["max_agent_calls"]))
                        if parts[3:] == ["stop"]:
                            return self._send(200, workflow.stop(token, rid))
                        if len(parts) == 6 and parts[3] == "tasks" and parts[5] == "retry":
                            return self._send(200, workflow.retry(token, rid, parts[4]))
                raise WorkflowError("NOT_FOUND", "Route not found", 404)
            except WorkflowError as error:
                return self._send(error.status, {"error": {"code": error.code, "message": error.message}})
            except (KeyError, TypeError, ValidationError):
                return self._send(400, {"error": {"code": "INVALID_INPUT", "message": "Request does not match the API contract"}})
            except Exception:
                return self._send(500, {"error": {"code": "INTERNAL_ERROR", "message": "Server operation failed"}})

        def do_GET(self):
            self._dispatch("GET")

        def do_POST(self):
            self._dispatch("POST")

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description="Conclave local workflow")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", default="workflow/data/conclave.sqlite3")
    parser.add_argument("--mode", choices=["mock", "pi"], default="mock")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.workers <= 16:
        parser.error("--workers must be between 1 and 16")
    if args.mode == "pi":
        root = Path(__file__).resolve().parents[1]
        modules = {role: Path(os.environ.get("CONCLAVE_" + role.upper() + "_MODULE",
                                             str(root / "agent" / role / "definition.mjs")))
                   for role in ("interview", "negotiate", "idea", "evaluator")}
        runner = PiRunner(modules)
    else:
        runner = MockRunner()
    workflow = Workflow(Store(args.db), runner)
    stop = threading.Event()

    def work():
        while not stop.is_set():
            try:
                progressed = workflow.run_once()
            except Exception:
                progressed = False
                print("Worker operation failed; pending leases remain recoverable.", flush=True)
            if not progressed:
                stop.wait(0.2)

    for _ in range(args.workers):
        threading.Thread(target=work, daemon=True).start()
    server = make_server(workflow, args.host, args.port)
    print(f"Conclave ({args.mode}) http://{args.host}:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
