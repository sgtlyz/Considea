"""Real teammate services with explicit model fixtures and an optional durable sync bridge."""
import copy
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
from uuid import uuid4

from .agents import MockRunner, ROOT
from .evaluation import EvaluationResult
from .privacy import public_snapshot
from .store import Store


class IntegrationError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class NodeBridge:
    def __init__(self, spacetime_config=None):
        self.config = str(Path(spacetime_config).resolve()) if spacetime_config else None
        self.process = None
        self.lock = threading.RLock()
        self.pending = {}
        self.boards = {}
        self.changed = threading.Condition()
        self.closed = False

    def _start(self):
        if self.closed:
            raise IntegrationError("BRIDGE_CLOSED")
        if self.process and self.process.poll() is None:
            return
        env = dict(os.environ)
        env.pop("CONCLAVE_SPACETIME_CONFIG", None)
        # ACP identities and registry credentials are unrelated to model tasks.
        env.pop("CONCLAVE_AGENTVERSE_SEEDS", None)
        env.pop("AGENTVERSE_API_KEY", None)
        if self.config:
            env["CONCLAVE_SPACETIME_CONFIG"] = self.config
        process = subprocess.Popen(["node", str(ROOT / "workflow/node/worker.mjs")], cwd=ROOT,
            env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", bufsize=1)
        self.process = process
        threading.Thread(target=self._read, args=(process,), daemon=True).start()

    def _read(self, process):
        try:
            for line in process.stdout:
                try:
                    value = json.loads(line)
                except ValueError:
                    continue
                if value.get("event") == "board":
                    with self.changed:
                        rid = value["room_id"]
                        self.boards[rid] = max(self.boards.get(rid, -1), value["revision"])
                        self.changed.notify_all()
                else:
                    with self.lock:
                        entry = self.pending.get(value.get("id"))
                    if entry and entry[0] is process:
                        entry[1].put(value)
        finally:
            process.stdout.close()
            with self.lock:
                for proc, response_queue in self.pending.values():
                    if proc is process:
                        response_queue.put({"error": "BRIDGE_DISCONNECTED"})

    def call(self, message, timeout=430):
        identifier, result_queue = uuid4().hex, queue.Queue()
        with self.lock:
            self._start()
            self.pending[identifier] = (self.process, result_queue)
            try:
                self.process.stdin.write(json.dumps({"id": identifier, **message}, ensure_ascii=False) + "\n")
                self.process.stdin.flush()
            except (OSError, ValueError):
                self.pending.pop(identifier, None)
                raise IntegrationError("BRIDGE_DISCONNECTED") from None
        try:
            result = result_queue.get(timeout=timeout)
            if "error" in result:
                raise IntegrationError(result["error"])
            return result["result"]
        except queue.Empty:
            raise IntegrationError("BRIDGE_TIMEOUT") from None
        finally:
            with self.lock:
                self.pending.pop(identifier, None)

    def close(self):
        with self.lock:
            self.closed = True
            if self.process and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
            if self.process and self.process.stdin and not self.process.stdin.closed:
                self.process.stdin.close()


class EvaluatorStub:
    def __call__(self, request):
        response = MockRunner()(request)
        report = response["data"]["evaluation"]
        report["summary"] = "EVALUATOR STUB: evaluation agent is not integrated; no feasibility or novelty research performed."
        report["risks"] = ["This report is a workflow test placeholder, not a completed evaluation."]
        response["warnings"] = ["EVALUATOR_STUB: testing only"]
        return response


class IntegratedRunner:
    def __init__(self, *, offline=False, evaluator="agent", spacetime_config=None, bridge=None):
        if evaluator not in ("agent", "stub", "blocked"):
            raise IntegrationError("CONFIG_ERROR")
        self.offline, self.evaluator = offline, evaluator
        self.credentials_for = lambda room_id: None
        self.mode = "integrated-offline" if offline else "integrated"
        self.bridge = bridge or NodeBridge(spacetime_config)
        self.description = {"model": "fixture" if offline else "live", "interview": "teammate-service",
            "negotiator": "teammate-llm", "idea": "teammate-service", "evaluator": evaluator,
            "idea_storage": "spacetimedb" if spacetime_config else "sqlite", "mem0": "disabled"}

    def __call__(self, request):
        result = self.run_task(request, {"attempt": 1})
        return result.response if isinstance(result, EvaluationResult) else result

    def run_task(self, request, claim):
        op = request["operation"]
        credentials = self.credentials_for(request["room_id"]) if not self.offline else None
        if op == "evaluator.evaluate":
            if self.evaluator == "blocked":
                raise IntegrationError("EVALUATOR_NOT_READY")
            if self.evaluator == "stub":
                return EvaluatorStub()(request)
            result = self.bridge.call({"action": "evaluate", "request": request,
                "context": claim.get("context"), "offline": self.offline, "credentials": credentials})
            return EvaluationResult(result["response"], result.get("report"))
        message = {"action": "agent", "request": request, "attempt": claim.get("attempt", 1), "credentials": credentials}
        if self.offline:
            if op == "negotiate.detect":
                # The baseline supplies an explicit offline model fixture only.
                # Live requests always use the same Pi LLM service as this fixture.
                from agent.negotiate import handle_request
                message["offline_response"] = handle_request(copy.deepcopy(request))
            else:
                message["offline_response"] = MockRunner()(copy.deepcopy(request))
        return self.bridge.call(message)

    def translate(self, room_id, texts):
        return self.bridge.call({"action": "translate", "room_id": room_id, "texts": texts,
            "offline": self.offline, "credentials": self.credentials_for(room_id) if not self.offline else None}, timeout=100)

    def close(self):
        self.bridge.close()


class SharedSync:
    """At-least-once delivery of the latest authorized projection, with monotonic DB writes."""
    def __init__(self, store, bridge):
        self.store, self.bridge = store, bridge
        self.connected = False
        self.last_error = None
        self.stopping = threading.Event()
        self.thread = None
        self.last_probe = 0

    def run_once(self):
        with self.store.transaction() as db:
            row = db.execute("SELECT * FROM shared_outbox WHERE delivered_revision < revision ORDER BY room_id LIMIT 1").fetchone()
            # Rebuild legacy pending snapshots before sending anything to the shared service.
            snapshot = public_snapshot(Store.load(db, row["room_id"])) if row else None
        if row is None:
            if time.monotonic() - self.last_probe >= 5:
                self.last_probe = time.monotonic()
                try:
                    self.bridge.call({"action": "connect"}, timeout=65)
                    self.connected, self.last_error = True, None
                except IntegrationError as error:
                    self.connected, self.last_error = False, error.code
            return False
        try:
            result = self.bridge.call({"action": "publish", "room_id": row["room_id"], "revision": row["revision"],
                "idea_revision": row["idea_revision"], "snapshot": snapshot}, timeout=65)
            with self.store.transaction() as db:
                db.execute("UPDATE shared_outbox SET delivered_revision=CASE WHEN delivered_revision < ? THEN ? ELSE delivered_revision END WHERE room_id=?",
                           (result["revision"], result["revision"], row["room_id"]))
            self.connected, self.last_error = True, None
            return True
        except IntegrationError as error:
            self.connected, self.last_error = False, error.code
            return False

    def start(self):
        def loop():
            while not self.stopping.is_set():
                try:
                    progress = self.run_once()
                except Exception:
                    self.connected, self.last_error, progress = False, "SYNC_ERROR", False
                if not progress:
                    self.stopping.wait(0.3 if self.last_error is None else 2)
        self.thread = threading.Thread(target=loop, daemon=True)
        self.thread.start()

    def status(self, room_id):
        return {"enabled": True, "connected": self.connected,
                "revision": self.bridge.boards.get(room_id, -1), "error": self.last_error}

    def close(self):
        self.stopping.set()
