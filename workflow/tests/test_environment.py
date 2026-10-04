"""Configuration boundaries: precedence, Windows files and worker inheritance."""
import contextlib
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from workflow import environment, server


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / ".env"
        self.addCleanup(self.temp.cleanup)
        self.env_patch = patch.dict(os.environ, {}, clear=False)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        for key in ("PI_PROVIDER", "DEEPSEEK_MODEL", "DEEPSEEK_API_KEY", "PYTHON_DOTENV_DISABLED"):
            os.environ.pop(key, None)
        self.path_patch = patch.object(environment, "ENV_FILE", self.path)
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)

    def test_bom_quotes_literal_secret_and_no_logging(self):
        secret = "synthetic-${HOME}-key#with=punctuation"
        self.path.write_text('export PI_PROVIDER=deepseek\nDEEPSEEK_API_KEY="' + secret + '" # comment\n', encoding="utf-8-sig")
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            environment.load_environment()
        self.assertEqual(os.environ["DEEPSEEK_API_KEY"], secret)
        self.assertEqual(os.environ["PI_PROVIDER"], "deepseek")
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")

    def test_terminal_wins_and_node_worker_inherits_loaded_values(self):
        self.path.write_text('DEEPSEEK_API_KEY=synthetic-file-key\nDEEPSEEK_MODEL=fixture-model\n', encoding="utf-8")
        os.environ["DEEPSEEK_API_KEY"] = "synthetic-shell-key"
        environment.load_environment()
        result = subprocess.run(["node", "-e", "process.exit(process.env.DEEPSEEK_API_KEY === 'synthetic-shell-key' && process.env.DEEPSEEK_MODEL === 'fixture-model' ? 0 : 1)"], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout + result.stderr, b"")

    def test_missing_repository_file_does_not_search_current_directory(self):
        other = Path(self.temp.name) / "unrelated"
        other.mkdir()
        (other / ".env").write_text('DEEPSEEK_API_KEY=wrong-project\n', encoding="utf-8")
        previous = Path.cwd()
        try:
            os.chdir(other)
            environment.load_environment()
        finally:
            os.chdir(previous)
        self.assertNotIn("DEEPSEEK_API_KEY", os.environ)

    def test_startup_loads_before_runner_and_keeps_offline_explicit(self):
        self.path.write_text('DEEPSEEK_API_KEY=synthetic-startup-key\n', encoding="utf-8")
        class StopBeforeWorkers(Exception):
            pass
        def construct(**kwargs):
            self.assertEqual(os.environ["DEEPSEEK_API_KEY"], "synthetic-startup-key")
            self.assertTrue(kwargs["offline"])
            raise StopBeforeWorkers
        with patch("sys.argv", ["workflow", "--mode", "integrated"]), patch.object(server, "IntegratedRunner", side_effect=construct):
            with self.assertRaises(StopBeforeWorkers):
                server.main()


if __name__ == "__main__":
    unittest.main()
