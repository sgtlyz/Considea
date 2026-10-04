"""Exercise the cloud entry point through real HTTP with a disposable database."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


class CloudStartTests(unittest.TestCase):
    def test_cloud_settings_and_restart_preserve_room(self):
        with tempfile.TemporaryDirectory() as folder:
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            database = Path(folder) / "state.sqlite3"
            env = {**os.environ, "HOST": "127.0.0.1", "PORT": str(port),
                   "CONCLAVE_MODE": "mock", "CONCLAVE_WORKERS": "1",
                   "CONCLAVE_DB": str(database), "CONCLAVE_SPACETIME_CONFIG": ""}
            origin = f"http://127.0.0.1:{port}"

            def start():
                process = subprocess.Popen(
                    [sys.executable, "-m", "deploy.start"], cwd=ROOT, env=env,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                self.addCleanup(stop, process)
                for _ in range(100):
                    if process.poll() is not None:
                        self.fail("Cloud entry point exited before becoming healthy")
                    try:
                        with urlopen(origin + "/api/health", timeout=1) as response:
                            self.assertEqual(json.load(response), {"status": "ok", "agent_mode": "mock"})
                        return process
                    except OSError:
                        time.sleep(0.1)
                self.fail("Cloud entry point did not become healthy")

            def stop(process):
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)

            first = start()
            request = Request(origin + "/api/rooms", method="POST",
                              headers={"Content-Type": "application/json"},
                              data=json.dumps({"room_context": {
                                  "member_ids": ["alice", "bob"],
                                  "hackathon_context": "Deployment smoke test",
                                  "deadline_at": None, "constraints": [],
                              }}).encode())
            with urlopen(request, timeout=5) as response:
                self.assertEqual(response.status, 201)
                room = json.load(response)
            self.assertTrue(database.is_file())
            stop(first)
            second = start()
            request = Request(origin + "/api/rooms/" + room["room_id"],
                              headers={"Authorization": "Bearer " + room["admin_token"]})
            with urlopen(request, timeout=5) as response:
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertEqual(json.load(response)["room_id"], room["room_id"])
            stop(second)

    def test_integrated_cloud_worker_runs_real_interview_offline(self):
        with tempfile.TemporaryDirectory() as folder:
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            env = {**os.environ, "HOST": "127.0.0.1", "PORT": str(port),
                   "CONCLAVE_MODE": "integrated", "CONCLAVE_MODEL": "offline",
                   "CONCLAVE_EVALUATOR": "agent", "CONCLAVE_WORKERS": "1",
                   "CONCLAVE_SPACETIME_CONFIG": "",
                   "CONCLAVE_DB": str(Path(folder) / "state.sqlite3")}
            origin = f"http://127.0.0.1:{port}"

            def request(path, data=None, token=None):
                headers = {"Content-Type": "application/json"}
                if token:
                    headers["Authorization"] = "Bearer " + token
                req = Request(origin + path, headers=headers,
                              data=json.dumps(data).encode() if data is not None else None)
                with urlopen(req, timeout=5) as response:
                    return json.load(response)

            process = subprocess.Popen([sys.executable, "-m", "deploy.start"],
                                       cwd=ROOT, env=env, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL)
            try:
                for _ in range(150):
                    if process.poll() is not None:
                        self.fail("Integrated cloud entry point exited before becoming healthy")
                    try:
                        health = request("/api/health")
                        break
                    except OSError:
                        time.sleep(0.1)
                else:
                    self.fail("Integrated cloud entry point did not become healthy")
                self.assertEqual(health["agent_mode"], "integrated-offline")
                room = request("/api/rooms", {"room_context": {
                    "member_ids": ["alice", "bob"], "hackathon_context": "Cloud fixture",
                    "deadline_at": None, "constraints": []}})
                path = "/api/rooms/" + room["room_id"]
                joined = request(path + "/join", {"invitation": room["invitations"]["alice"]})
                for _ in range(150):
                    view = request(path, token=joined["token"])
                    if view["private"]["stage"] == "awaiting_answers":
                        break
                    time.sleep(0.1)
                else:
                    self.fail("Deployed Node bridge failed to produce interview questions")
                self.assertTrue(view["private"]["question_batch"]["questions"])
                self.assertEqual(view["agent_runtime"]["model"], "fixture")
                self.assertEqual(view["agent_runtime"]["evaluator"], "agent")
                self.assertEqual(view["agent_runtime"]["mem0"], "disabled")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

    def test_live_settings_and_private_spacetime_path_reach_server(self):
        from deploy.start import main
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / "spacetime.json"
            config.write_text("{}", encoding="utf-8")
            with patch.dict(os.environ, {"CONCLAVE_MODE": "integrated", "CONCLAVE_MODEL": "live",
                    "CONCLAVE_EVALUATOR": "agent", "CONCLAVE_SPACETIME_CONFIG": str(config)}, clear=True), \
                    patch("workflow.environment.load_environment"), \
                    patch("workflow.server.main") as serve, patch.object(sys, "argv", []):
                main()
                serve.assert_called_once()
                args = dict(zip(sys.argv[1::2], sys.argv[2::2]))
                self.assertEqual(args["--mode"], "integrated")
                self.assertEqual(args["--model"], "live")
                self.assertEqual(args["--evaluator"], "agent")
                self.assertEqual(args["--spacetime-config"], str(config))

    def test_missing_spacetime_file_fails_before_serving(self):
        from deploy.start import main
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(os.environ, {"CONCLAVE_MODE": "integrated",
                    "CONCLAVE_SPACETIME_CONFIG": str(Path(folder) / "missing.json")}, clear=True), \
                    patch("workflow.environment.load_environment"), \
                    patch("workflow.server.main") as serve, patch.object(sys, "argv", []):
                with self.assertRaisesRegex(SystemExit, "existing private JSON file"):
                    main()
                serve.assert_not_called()

    def test_pi_mode_fails_before_serving_if_role_definition_is_missing(self):
        with tempfile.TemporaryDirectory() as folder:
            env = {**os.environ, "CONCLAVE_MODE": "pi",
                   "CONCLAVE_INTERVIEW_MODULE": str(Path(folder) / "absent.mjs")}
            result = subprocess.run([sys.executable, "-m", "deploy.start"], cwd=ROOT,
                                    env=env, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing role definitions: interview", result.stderr)


if __name__ == "__main__":
    unittest.main()
