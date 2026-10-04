"""Publish the module and prepare a private SDK config for a selected development server."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
from .agents import ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", default="spacetime")
    parser.add_argument("--server", default="http://127.0.0.1:3000")
    parser.add_argument("--database", default="considea-dev")
    parser.add_argument("--config", default="workflow/data/spacetime.json")
    parser.add_argument("--cli-config", default="workflow/data/spacetime-cli.toml")
    args = parser.parse_args()
    cli = shutil.which(args.cli) or str(Path(args.cli).resolve())
    pnpm = shutil.which("pnpm")
    if not pnpm:
        parser.error("Install pnpm before preparing the development database")
    output = Path(args.config).resolve()
    cli_config = Path(args.cli_config).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    cli_config.parent.mkdir(parents=True, exist_ok=True)
    # No --delete-data or blanket --yes: an incompatible existing DB must be reviewed.
    subprocess.run([cli, "--config-path", str(cli_config), "publish", "--server", args.server,
        "--module-path", "agent/idea/spacetime", "--yes=skip-login", "--no-config", args.database], cwd=ROOT, check=True)
    subprocess.run([cli, "generate", "--lang", "typescript", "--out-dir", "workflow/node/module_bindings",
        "--module-path", "agent/idea/spacetime"], cwd=ROOT, check=True)
    subprocess.run([pnpm, "--dir", "workflow/node", "build"], cwd=ROOT, check=True)
    # Read this tool's dedicated CLI config; never print or put the token in a command argument.
    match = re.search(r'^spacetimedb_token\s*=\s*"([A-Za-z0-9_.-]+)"', cli_config.read_text(encoding="utf-8"), re.M)
    if not match:
        raise RuntimeError("Local CLI owner token missing; configure owner_token privately")
    previous = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {}
    config = previous if previous.get("uri") == args.server and previous.get("database") == args.database else {}
    config.update(uri=args.server, database=args.database, owner_token=match.group(1))
    output.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print("Prepared development module and private configuration:", output)


if __name__ == "__main__":
    main()
