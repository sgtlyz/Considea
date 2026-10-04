"""Create private identities or explicitly register tested live ACP endpoints."""
import argparse
import json
import logging
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from .agentverse_chat import HELP, ROLES
from .environment import load_environment


def check_status(base_url, seeds, roles, status):
    from uagents_core.identity import Identity
    url = urlsplit(base_url)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
        raise ValueError("Use the deployed backend's public HTTPS origin")
    if not status.get("enabled") or status.get("mode") != "integrated" or status.get("offline") is not False:
        raise ValueError("Registration requires enabled, integrated live endpoints")
    for role in roles:
        actual = status.get("agents", {}).get(role, {})
        if actual.get("address") != Identity.from_seed(seeds[role], 0).address or actual.get("path") != f"/agentverse/{role}/chat":
            raise ValueError("The deployed identity does not match the private registration seed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--init", type=Path, help="Create a private seed map once; never overwrite an existing file")
    parser.add_argument("--seeds-file", type=Path)
    parser.add_argument("--base-url")
    parser.add_argument("--role", action="append", choices=list(ROLES), help="Repeat for each agent; defaults to all four roles")
    parser.add_argument("--key-file", type=Path, help="Private file containing the Agentverse account API key")
    parser.add_argument("--output", type=Path, default=Path("docs/agentverse-agents.json"))
    args = parser.parse_args()
    roles = list(dict.fromkeys(args.role or list(ROLES)))
    if args.init:
        args.init.parent.mkdir(parents=True, exist_ok=True)
        with args.init.open("x", encoding="utf-8") as f:
            json.dump({role: secrets.token_urlsafe(48) for role in roles}, f)
        os.chmod(args.init, 0o600)
        print("Private identity file created. Back it up securely; do not commit it.")
        return
    if not args.seeds_file or not args.base_url:
        parser.error("Supply --seeds-file and --base-url, or use --init")
    load_environment()
    import requests
    from uagents_core.utils.registration import RegistrationRequestCredentials, register_chat_agent
    logging.getLogger("uagents_core.utils.registration").setLevel(logging.CRITICAL)
    try:
        seeds = json.loads(args.seeds_file.read_text(encoding="utf-8-sig"))
        key = args.key_file.read_text(encoding="utf-8-sig").strip() if args.key_file else os.environ.get("AGENTVERSE_API_KEY")
        if not key:
            raise ValueError("Provide a private Agentverse API key file or local environment variable")
        base = args.base_url.rstrip("/")
        response = requests.get(base + "/agentverse/status", timeout=30)
        response.raise_for_status()
        status = response.json()
        check_status(base, seeds, roles, status)
    except Exception:
        raise SystemExit("Preflight failed. Check private configuration and deployed live identities; no registration attempted.") from None
    manifest = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {}
    for role in roles:
        name, description = ROLES[role]
        address = status["agents"][role]["address"]
        endpoint = base + status["agents"][role]["path"]
        readme = (f"# {name}\n\n![innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3) "
                  "![hackathon](https://img.shields.io/badge/hackathon-MHacks-orange)\n\n"
                  f"{description}\n\nThis is a role-specific entrance to Considea's shared workflow. "
                  "It invokes the same Interview, Negotiator, Idea Generator and Evaluator implementations as the web app. "
                  "Each private ASI session must join or recover its own room membership. "
                  "The workflow runs model tasks asynchronously; use /status to retrieve their results. "
                  "The user can complete the primary workflow in ASI:One using the commands below. "
                  "A team demo access code from the project team is required to create a live room. "
                  "Invited participants do not need model API keys.\n\n"
                  "## Consent and limitations\n\n"
                  "Never send /approve, /vote, /accept, /revise or /discuss without the participant's explicit choice. "
                  "Show the current draft or report first. Never synthesize member answers, votes or credentials. "
                  "Never include invitations or recovery codes in a public/shared chat link. "
                  "ASI:One/Agentverse relay chat messages; Considea stores private transcripts and approved team records, "
                  "and the configured model/search providers process authorized task context. "
                  "Private member transcripts are not exposed to teammates. "
                  "External evidence supports recommendations; it does not prove technical feasibility. "
                  "Usage limits pause work instead of fabricating results or consensus.\n\n"
                  f"## Commands\n\n```text\n{HELP}\n```\n\n"
                  "[Public source](https://github.com/sgtlyz/Considea) · "
                  "[Web workspace](https://considea.vercel.app)\n")
        try:
            confirmed = register_chat_agent(name=name, endpoint=endpoint, active=True,
                credentials=RegistrationRequestCredentials(agent_seed_phrase=seeds[role], agentverse_api_key=key),
                description=description, readme=readme, track_interactions=False,
                starter_prompts=["/help", "/status"],
                metadata={"categories": ["innovationlab", "hackathon", "productivity"], "is_public": "True"})
            if not confirmed:
                raise ValueError("Unconfirmed registration")
        except Exception:
            raise SystemExit(f"Registration not confirmed for {role}. Inspect Agentverse before retrying with the same seed.") from None
        manifest[role] = {"name": name, "address": address, "endpoint": endpoint,
                          "profile_url": f"https://agentverse.ai/agents/details/{address}/profile",
                          "asi_url": f"https://asi1.ai/ai/{address}", "registration_confirmed": True}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"role": role, "profile_url": manifest[role]["profile_url"], "registration_confirmed": True}))


if __name__ == "__main__":
    main()
