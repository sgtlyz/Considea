"""ACP role interfaces. The existing authenticated Workflow remains authoritative."""
import asyncio
import hashlib
import json
import re
import secrets
from urllib.parse import urlparse

import httpx
from .catalog import ROLES
from .persistence import GatewayStore, Store


class Gateway:
    def __init__(self, config, client=None, store=None):
        self.config = config
        base = config["workflow_url"].rstrip("/")
        url = urlparse(base)
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or url.path:
            raise ValueError("Configure one fixed HTTPS workflow origin")
        self.client = client or httpx.AsyncClient(base_url=base, timeout=25, follow_redirects=False)
        self.store = store or GatewayStore(Store(config["state_file"]), owned=True)
        self.lock = asyncio.Lock()

    async def close(self):
        await self.client.aclose()
        self.store.close()

    async def api(self, method, path, body=None, token=None):
        headers = {"Authorization": "Bearer " + token} if token else {}
        response = await self.client.request(method, path, json=body, headers=headers)
        if response.status_code >= 300:
            # Raw upstream diagnostics may contain secrets or private data.
            raise ValueError("Workflow rejected the request (HTTP %s). Refresh /status and check the command; no automatic retry." % response.status_code)
        return response.json()

    async def call(self, message):
        async with self.lock:
            role = message["role"]
            if role not in ROLES:
                raise ValueError("Unknown role")
            sid = hashlib.sha256(json.dumps([role, message["sender"], message["session_id"]]).encode()).hexdigest()
            mid = hashlib.sha256((sid + message["msg_id"]).encode()).hexdigest()
            text = message["text"].strip()
            if len(text.encode("utf-8")) > 32_000:
                return {"text": "Message is too large; maximum 32 KB."}
            digest = hashlib.sha256(text.encode()).hexdigest()
            old = self.store.reserve(sid, mid, digest)
            if old is not None:
                return {"text": old}
            session = self.store.session(sid)
            try:
                result = await self.dispatch(role, text, session, mid)
            except (ValueError, KeyError, TypeError, IndexError):
                result = "Command not accepted. Check /help and /status; no approval was inferred and no automatic retry was made."
            except Exception:
                result = "Workflow connection unavailable or outcome uncertain. Use /status before retrying a new command."
            self.store.complete(sid, mid, session, result)
            return {"text": result}

    async def dispatch(self, role, text, session, mid):
        command, _, arg = text.partition(" ")
        if command.lower() in ("/help", "help", "start", "hello", "你好", "开始"):
            return (ROLES[role][1] + "\n\nCommands:\n"
                    "/join ROOM_ID ONE_USE_INVITATION — connect your private member account\n"
                    "/status — fetch your current authorized state and event revisions\n"
                    "/event JSON — submit an explicit Considea v2 human event\n"
                    "/export — retrieve the unanimously accepted brief\n"
                    "/handoff ROLE — issue a 10-minute one-use transfer to another role\n"
                    "/resume CODE — connect that role using your one-use transfer\n"
                    "/create JSON — create a team using room_context, config and access_code, if enabled\n"
                    "Do not paste API keys. Each member must join and approve in their own conversation. "
                    "Status includes the exact references needed by events; never invent answers or approvals.")
        if command == "/resume":
            if session:
                raise ValueError("Already connected")
            key = hashlib.sha256(arg.encode()).hexdigest()
            session.update(self.store.resume(key, role))
            return "Connected to the same member and room. Use /status."
        if command == "/create":
            if not self.config.get("allow_create", False):
                return "New room creation is disabled pending an operator-approved live allowance. Existing invited members may use /join."
            if session:
                return "This conversation already has a room. Use a new private conversation to create another."
            body = json.loads(arg)
            if not isinstance(body, dict) or not set(body) <= {"room_context", "config", "access_code"}:
                raise ValueError("Invalid create fields")
            result = await self.api("POST", "/api/rooms", body)
            session.update(room_id=result["room_id"], token=result["admin_token"], kind="admin")
            return json.dumps({"room_id": result["room_id"], "invitations": result["invitations"],
                               "instruction": "Send each invitation only to its intended member. Join from a separate private ASI conversation."}, ensure_ascii=False)
        if command == "/join":
            if session:
                return "This conversation already has a room. Use a new private conversation to join another."
            room, invitation = arg.split()
            if not re.fullmatch(r"room-[a-f0-9]{32}", room):
                raise ValueError("Invalid room")
            result = await self.api("POST", f"/api/rooms/{room}/join", {"invitation": invitation})
            session.update(room_id=room, token=result["token"], kind="member")
            return "Joined as " + result["member_id"] + ". Use /status to read your questions."
        if not session:
            return "Join your team first: /join ROOM_ID ONE_USE_INVITATION. Use /help for the workflow."
        room = session["room_id"]
        if command == "/handoff":
            if arg not in ROLES or arg == role:
                raise ValueError("Invalid target role")
            code = secrets.token_urlsafe(32)
            self.store.transfer(hashlib.sha256(code.encode()).hexdigest(), arg, session)
            return f"In your private Considea {arg} conversation, send /resume {code}. This one-use code grants your member access and expires in 10 minutes. Do not share it."
        if command in ("/status", "/export"):
            view = await self.api("GET", f"/api/rooms/{room}", token=session["token"])
            if command == "/export":
                return json.dumps(view.get("final_output"), ensure_ascii=False) if view.get("final_output") else "No unanimously accepted final brief exists yet."
            # Do not expose private interviews through shared-role interfaces.
            if role != "interview":
                view.pop("private", None)
            return json.dumps(view, ensure_ascii=False)
        if command == "/event":
            event = json.loads(arg)
            allowed = {"interview": {"interview.answer", "profile.approve"},
                       "negotiate": {"difference.answer", "convergence.vote"},
                       "idea": {"candidate.review"}, "evaluator": {"candidate.review"}}
            if not isinstance(event, dict) or event.get("type") not in allowed[role] or event.get("room_id") != room:
                raise ValueError("Wrong event role or room")
            # Preserve the user's revision and payload: never auto-refresh stale approvals.
            event["event_id"] = "asi-" + mid
            return json.dumps(await self.api("POST", f"/api/rooms/{room}/events", event, session["token"]), ensure_ascii=False)
        return "Use /status to inspect the current workflow, then submit an explicit /event. Free text is not treated as approval."
