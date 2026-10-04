"""Private JSONL bridge. No registration, network listener, or model call on import."""
import asyncio
import json
import os
from pathlib import Path


class NodeBridge:
    def __init__(self, *, live=False, state_dir=None, max_calls=0, max_usd=0):
        self.live, self.state_dir, self.max_calls = live, state_dir, max_calls
        self.max_usd = max_usd
        self.process = None
        self.lock = asyncio.Lock()

    async def start(self):
        root = Path(__file__).resolve().parent
        args = [os.environ.get("CONSIDEA_NODE", "node")]
        env_file = root.parent / ".env"
        if self.live and env_file.is_file():
            args.append(f"--env-file={env_file}")
        args.append(str(root / "worker.mjs"))
        if self.live:
            args.append("--live")
        env = dict(os.environ)
        if self.state_dir:
            env["CONSIDEA_STATE_DIR"] = str(self.state_dir)
        env["CONSIDEA_MAX_MODEL_CALLS"] = str(self.max_calls)
        env["CONSIDEA_MAX_USD"] = str(self.max_usd)
        self.process = await asyncio.create_subprocess_exec(
            *args, cwd=root, env=env, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            limit=2_000_000,
        )

    async def call(self, message):
        async with self.lock:
            if self.process is None:
                await self.start()
            if self.process.returncode is not None:
                raise RuntimeError("Worker unavailable; no automatic restart or API retry")
            self.process.stdin.write((json.dumps(message, ensure_ascii=False) + "\n").encode())
            await self.process.stdin.drain()
            try:
                line = await asyncio.wait_for(self.process.stdout.readline(), 135)
                if not line:
                    raise RuntimeError("Worker exited")
                return json.loads(line)
            except (TimeoutError, ValueError, asyncio.CancelledError):
                await self.close()
                raise

    async def close(self):
        if self.process and self.process.returncode is None:
            self.process.kill()
            await self.process.wait()
