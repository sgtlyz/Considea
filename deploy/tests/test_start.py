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
                   "CONCLAVE_DB": str(database)}
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
