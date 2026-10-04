"""Official uagents-core ACP adapter; no ledger/grpc dependency. Run one worker."""
import asyncio
import json
import time
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from uagents_core.contrib.protocols.chat import ChatMessage, ChatAcknowledgement, TextContent, chat_protocol_spec
from uagents_core.envelope import Envelope
from uagents_core.identity import Identity
from uagents_core.models import Model
from uagents_core.utils.messages import parse_envelope, send_message_to_agent
from bridge import NodeBridge


def create_app(config, *, bridge=None, send=None):
    identity = Identity.from_seed(config["seed"], 0)
    bridge = bridge or NodeBridge(live=config.get("live", False), state_dir=config["state_dir"],
                                 max_calls=config.get("max_calls", 0), max_usd=config.get("max_usd", 0))
    send = send or send_message_to_agent
    pending = 0

    @asynccontextmanager
    async def lifespan(app):
        yield
        await bridge.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/status")
    @app.get("/")
    async def status():
        return {"name": "Considea Interview", "address": identity.address, "status": "online",
                "mode": "live" if config.get("live") else "offline_mock",
                "protocol": chat_protocol_spec.name, "protocol_version": chat_protocol_spec.version}

    async def deliver(env, message):
        # Preserve the verified envelope's conversation; do not use user-supplied callback URLs.
        return await asyncio.to_thread(send, destination=env.sender, msg=message, sender=identity,
                                       session_id=env.session, timeout=10, track_interaction=False)

    async def process(env, msg):
        nonlocal pending
        try:
            await deliver(env, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
            text = "\n".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
            # ASI direct-chat text may carry this agent's routing mention.
            # Strip only our exact address, never arbitrary users' mentions.
            text = re.sub(r"^@" + re.escape(identity.address) + r"\s+", "", text).strip()
            if not text:
                return
            result = await bridge.call({"sender": env.sender, "session_id": str(env.session),
                                        "msg_id": str(msg.msg_id), "text": text})
            await deliver(env, ChatMessage(content=[TextContent(type="text", text=result["text"])]))
        except Exception:
            # Never forward provider exceptions, tokens or private transcript to public logs.
            try:
                await deliver(env, ChatMessage(content=[TextContent(type="text", text="服务暂不可用；没有自动重试或批准。稍后可用 /profile 检查已保存状态。")]))
            except Exception:
                pass
        finally:
            pending -= 1

    @app.post("/chat")
    async def chat(request: Request, background: BackgroundTasks):
        nonlocal pending
        raw = bytearray()
        async for part in request.stream():
            raw.extend(part)
            if len(raw) > 100_000:
                raise HTTPException(413, "Envelope too large")
        try:
            env = Envelope.model_validate_json(bytes(raw))
            if env.version != 1 or env.target != identity.address or not env.verify() or (env.expires is not None and env.expires <= time.time()):
                raise ValueError("Invalid signed envelope")
        except Exception:
            raise HTTPException(401, "Invalid signed envelope") from None
        if env.schema_digest == Model.build_schema_digest(ChatAcknowledgement):
            return {"status": "acknowledged"}  # Never reply to an ACK.
        if env.schema_digest != Model.build_schema_digest(ChatMessage):
            raise HTTPException(400, "Unsupported chat schema")
        try:
            msg = parse_envelope(env, ChatMessage)
            if not isinstance(msg, ChatMessage):
                raise ValueError("Invalid chat payload")
        except Exception:
            raise HTTPException(400, "Invalid chat payload") from None
        if pending >= 8:
            raise HTTPException(429, "Busy; retry this message later")
        pending += 1
        background.add_task(process, env, msg)
        return {"status": "accepted"}

    return app


if __name__ == "__main__":
    import argparse
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--port", type=int, default=8011)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    uvicorn.run(create_app(config), host="127.0.0.1", port=args.port, access_log=False)
