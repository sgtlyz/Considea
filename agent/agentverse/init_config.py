"""Create private stable identities once. Never print seeds or change existing identities."""
import argparse
import json
import secrets
from pathlib import Path
from .catalog import ROLES


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=".agentverse-local/config.json")
    parser.add_argument("--interview-config", help="Reuse the existing Interview identity")
    args = parser.parse_args()
    path = Path(args.config).resolve()
    if path.exists():
        raise SystemExit("Configuration already exists; preserved without changes")
    seeds = {role: secrets.token_urlsafe(48) for role in ROLES}
    if args.interview_config:
        seeds["interview"] = json.loads(Path(args.interview_config).read_text(encoding="utf-8"))["seed"]
    config = {"seeds": seeds, "workflow_url": "https://considea-dev-api.onrender.com",
              "state_file": str(path.parent / "sessions.sqlite3"), "allow_create": False}
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as file:
        json.dump(config, file, indent=2)
    print("Private configuration created. New room creation is disabled by default.")


if __name__ == "__main__":
    main()
