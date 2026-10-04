"""Four stable ACP identities on one HTTPS gateway, backed by the integrated workflow."""
import asyncio
import json
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from uagents_core.contrib.protocols.chat import ChatMessage, ChatAcknowledgement, TextContent
from uagents_core.envelope import Envelope
from uagents_core.identity import Identity
from uagents_core.models import Model
from uagents_core.utils.messages import parse_envelope, send_message_to_agent
from .catalog import ROLES
from .gateway import Gateway


def create_app(config, gateway=None, send=None):
    identities = {role: Identity.from_seed(config["seeds"][role], 0) for role in ROLES}
    gateway = gateway or Gateway(config)
    send = send or send_message_to_agent
    pending = 0

    @asynccontextmanager
    async def lifespan(app):
        yield
        await gateway.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/status")
    async def status():
        return {"status": "gateway_online", "agents": {r: i.address for r, i in identities.items()},
                "workflow_url": config["workflow_url"], "workflow_health": "not_checked", "new_rooms_enabled": config.get("allow_create", False)}

    async def process(role, env, msg):
        nonlocal pending
        async def deliver(reply):
            await asyncio.to_thread(send, destination=env.sender, msg=reply, sender=identities[role],
                                    session_id=env.session, timeout=15, track_interaction=False)
        try:
            await deliver(ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
            text = "\n".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
            text = re.sub(r"^@" + re.escape(identities[role].address) + r"\s+", "", text)
            if text:
                result = await gateway.call({"role": role, "sender": env.sender, "session_id": str(env.session),
                                             "msg_id": str(msg.msg_id), "text": text})
                await deliver(ChatMessage(content=[TextContent(type="text", text=result["text"])]))
        except Exception:
            # Never log private messages or upstream exceptions. A lost reply does not undo a stored action.
            pass
        finally:
            pending -= 1

    @app.post("/{role}/chat")
    async def chat(role: str, request: Request, background: BackgroundTasks):
        nonlocal pending
        if role not in identities:
            raise HTTPException(404)
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 100_000:
                raise HTTPException(413)
        try:
            env = Envelope.model_validate_json(bytes(raw))
            if env.version != 1 or env.target != identities[role].address or not env.verify() or (env.expires is not None and env.expires <= time.time()):
                raise ValueError()
        except Exception:
            raise HTTPException(401, "Invalid signed envelope") from None
        if env.schema_digest == Model.build_schema_digest(ChatAcknowledgement):
            return {"status": "acknowledged"}
        if env.schema_digest != Model.build_schema_digest(ChatMessage):
            raise HTTPException(400, "Unsupported protocol")
        try:
            msg = parse_envelope(env, ChatMessage)
        except Exception:
            raise HTTPException(400, "Invalid chat") from None
        if pending >= 8:
            raise HTTPException(429)
        pending += 1
        background.add_task(process, role, env, msg)
        return {"status": "accepted"}

    return app


if __name__ == "__main__":
    import argparse
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--port", type=int, default=8012)
    args = parser.parse_args()
    uvicorn.run(create_app(json.loads(Path(args.config).read_text(encoding="utf-8"))), host="127.0.0.1", port=args.port, access_log=False)
