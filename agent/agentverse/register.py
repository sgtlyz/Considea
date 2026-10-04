"""Explicit registration, one role at a time; never automatically retry uncertainty."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from uagents_core.identity import Identity
from uagents_core.utils.registration import RegistrationRequestCredentials, register_chat_agent
from .catalog import ROLES, readme


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--key-file", required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--role", choices=ROLES, required=True)
    parser.add_argument("--path-prefix", choices=["", "/agentverse"], default="/agentverse")
    args = parser.parse_args()
    url = urlparse(args.origin)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
        raise SystemExit("Use the tested HTTPS gateway origin")
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    role = args.role
    seed = config["seeds"][role]
    address = Identity.from_seed(seed, 0).address
    key = Path(args.key_file).read_text(encoding="utf-8-sig").strip()
    try:
        ok = register_chat_agent(name=ROLES[role][0], endpoint=args.origin.rstrip("/") + args.path_prefix + f"/{role}/chat", active=True,
             credentials=RegistrationRequestCredentials(agent_seed_phrase=seed, agentverse_api_key=key),
             description=ROLES[role][1], readme=readme(role) + f"\nAgent address: `{address}`\n",
             track_interactions=False, starter_prompts=["/help", "/status"],
             metadata={"categories": ["innovationlab", "hackathon", "productivity"], "is_public": "True"})
    except Exception:
        raise SystemExit("Registration outcome uncertain. Inspect dashboard before retrying.") from None
    if not ok:
        raise SystemExit("Registration not confirmed")
    print(json.dumps({"role": role, "address": address, "registered": True}))


if __name__ == "__main__":
    main()
