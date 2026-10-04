"""Generate a stable private identity once; offline mode is the default."""
import json
import os
from pathlib import Path
import secrets
from uagents_core.identity import Identity

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[3]
    folder = root / ".interview-local"
    folder.mkdir(exist_ok=True)
    path = folder / "agentverse-config.json"
    if not path.exists():
        config = {"seed": secrets.token_urlsafe(48), "state_dir": str(folder / "single-agent"),
                  "live": False, "max_calls": 0, "max_usd": 0}
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
    config = json.loads(path.read_text(encoding="utf-8"))
    print(json.dumps({"config_path": str(path), "address": Identity.from_seed(config["seed"], 0).address,
                      "mode": "live" if config.get("live") else "offline_mock"}))
