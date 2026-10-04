"""Load only the repository's local .env before starting agent workers."""
from pathlib import Path

from dotenv import load_dotenv

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


def load_environment():
    # Explicit path prevents loading an unrelated parent/CWD .env. Keep secrets
    # literal, accept Windows UTF-8 BOM, and preserve shell/deployment overrides.
    return load_dotenv(ENV_FILE, override=False, interpolate=False, encoding="utf-8-sig")
