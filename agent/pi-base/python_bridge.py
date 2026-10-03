"""Optional Python workflow adapter. No uAgents registration or model calls on import."""
import asyncio
import json
import os
from pathlib import Path


async def call_agent(request: dict, *, role_module: str, timeout_seconds: float = 70) -> dict:
    base = Path(__file__).resolve().parent
    env = {**os.environ, "AGENT_MODULE": str(Path(role_module).resolve())}
    process = await asyncio.create_subprocess_exec(
        "node", str(base / "cli.mjs"), cwd=base, env=env,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _ = await asyncio.wait_for(
            process.communicate((json.dumps(request) + "\n").encode()), timeout_seconds
        )
    except (TimeoutError, asyncio.CancelledError):
        if process.returncode is None:
            process.kill()
        await process.communicate()
        raise
    if process.returncode != 0:
        raise RuntimeError("Pi worker failed; no private stderr forwarded")
    result = json.loads(stdout)
    if any(result.get(k) != request.get(k) for k in
           ("schema_version", "request_id", "room_id", "operation", "input_revision")):
        raise RuntimeError("Pi worker returned mismatched envelope")
    return result
