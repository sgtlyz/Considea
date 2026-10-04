"""Run the existing workflow with cloud-provided configuration."""
import os
import sys
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    mode = os.environ.get("CONCLAVE_MODE", "mock")
    if mode == "pi":
        missing = []
        for role in ("interview", "negotiate", "idea", "evaluator"):
            module = Path(os.environ.get(
                f"CONCLAVE_{role.upper()}_MODULE",
                str(root / "agent" / role / "definition.mjs"),
            ))
            if not module.is_file():
                missing.append(role)
        if missing:
            raise SystemExit("Cannot start pi mode: missing role definitions: " + ", ".join(missing))
    from workflow.server import main as serve
    sys.argv = [
        "considea",
        "--host", os.environ.get("HOST", "0.0.0.0"),
        "--port", os.environ.get("PORT", "10000"),
        "--db", os.environ.get("CONCLAVE_DB", "workflow/data/conclave.sqlite3"),
        "--mode", mode,
        "--workers", os.environ.get("CONCLAVE_WORKERS", "2"),
    ]
    serve()


if __name__ == "__main__":
    main()
