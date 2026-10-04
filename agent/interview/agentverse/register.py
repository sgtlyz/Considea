"""Explicit public registration step; never runs on application import/startup."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uagents_core.identity import Identity
from uagents_core.utils.registration import RegistrationRequestCredentials, register_chat_agent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--key-file", help="Optional private local file containing only the Agentverse API key")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    url = urlparse(args.endpoint)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.path != "/chat" or url.query or url.fragment:
        raise SystemExit("Use your tested public HTTPS /chat endpoint")
    if not config.get("live") or not 1 <= config.get("max_calls", 0) <= 92 or not 0.025 <= config.get("max_usd", 0) <= 2.3:
        raise SystemExit("Registration requires a tested live configuration and finite approved model budget")
    api_key = Path(args.key_file).read_text(encoding="utf-8-sig").strip() if args.key_file else os.environ.get("AGENTVERSE_API_KEY")
    if not api_key:
        raise SystemExit("Set AGENTVERSE_API_KEY locally; never paste it into public code or logs")
    address = Identity.from_seed(config["seed"], 0).address
    readme = Path(__file__).with_name("AGENT_README.md").read_text(encoding="utf-8")
    try:
        ok = register_chat_agent(name="Considea Interview", endpoint=args.endpoint, active=True,
            credentials=RegistrationRequestCredentials(agent_seed_phrase=config["seed"], agentverse_api_key=api_key),
            description="Turn an individual hackathon interview into a persistent, reviewed preference profile and a concise handoff brief.",
            readme=readme + f"\nAgent address: `{address}`\n", track_interactions=False,
            starter_prompts=["Start a hackathon preference interview", "Help me clarify my skills, ideas and non-negotiable preferences"],
            metadata={"categories": ["innovationlab", "hackathon", "productivity"], "is_public": "True"})
    except Exception:
        raise SystemExit("Registration not confirmed. Inspect the Agentverse dashboard before retrying; no secrets logged.") from None
    if not ok:
        raise SystemExit("Registration not confirmed")
    print(json.dumps({"registered": True, "address": address, "profile_url": f"https://agentverse.ai/agents/details/{address}/profile"}))


if __name__ == "__main__":
    main()
