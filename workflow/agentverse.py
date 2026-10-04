"""Optional signed Agent Chat Protocol endpoints for the existing workflow.

Registration is an explicit operator action. Starting the HTTP server never
publishes agents or sends credentials to Agentverse.
"""
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from .agentverse_chat import ChatWorkflow, ROLES
from .engine import WorkflowError
from .store import digest


class Agentverse:
    def __init__(self, workflow, security, seeds, *, send=None):
        from uagents_core.identity import Identity
        from uagents_core.utils.messages import send_message_to_agent
        if not isinstance(seeds, dict) or not seeds or set(seeds) - set(ROLES):
            raise ValueError("Configure a seed map containing supported Agentverse roles")
        if any(not isinstance(s, str) or len(s) < 32 for s in seeds.values()) or len(set(seeds.values())) != len(seeds):
            raise ValueError("Each role needs a distinct private seed of at least 32 characters")
        self.identities = {role: Identity.from_seed(seed, 0) for role, seed in seeds.items()}
        self.chat = ChatWorkflow(workflow, security)
        self.security, self.store = security, workflow.store
        self.send = send or send_message_to_agent
        self.pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="agentverse")
        self.slots = threading.BoundedSemaphore(8)
        self.locks = [threading.Lock() for _ in range(64)]
        with self.store.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS agentverse_receipts (receipt_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, reply TEXT, created_at DOUBLE PRECISION NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS agentverse_locks (session_key TEXT PRIMARY KEY, expires_at DOUBLE PRECISION NOT NULL)")

    @classmethod
    def configured(cls, workflow, security):
        value = security.env.get("CONCLAVE_AGENTVERSE_SEEDS")
        return cls(workflow, security, json.loads(value)) if value else None

    def close(self):
        self.pool.shutdown(wait=True)

    def status(self):
        runner = self.chat.workflow.runner
        return {"enabled": True, "mode": runner.mode, "offline": getattr(runner, "offline", runner.mode != "integrated"),
                "protocol": "AgentChatProtocol", "agents": {
                    role: {"name": ROLES[role][0], "address": identity.address,
                           "path": f"/agentverse/{role}/chat"}
                    for role, identity in self.identities.items()}}

    def receive(self, role, body):
        from uagents_core.contrib.protocols.chat import ChatMessage, ChatAcknowledgement, TextContent
        from uagents_core.envelope import Envelope
        from uagents_core.models import Model
        from uagents_core.utils.messages import parse_envelope
        if role not in self.identities:
            raise WorkflowError("NOT_FOUND", "Agent is not configured", 404)
        try:
            env = Envelope.model_validate(body)
            if env.version != 1 or env.target != self.identities[role].address or not env.verify():
                raise ValueError("Invalid signature or target")
            if env.expires is not None and env.expires <= time.time():
                raise ValueError("Expired envelope")
        except Exception:
            raise WorkflowError("UNAUTHORIZED", "Invalid signed envelope", 401) from None
        if env.schema_digest == Model.build_schema_digest(ChatAcknowledgement):
            return {"status": "acknowledged"}
        if env.schema_digest != Model.build_schema_digest(ChatMessage):
            raise WorkflowError("INVALID_INPUT", "Unsupported chat schema")
        try:
            msg = parse_envelope(env, ChatMessage)
            age = time.time() - msg.timestamp.timestamp()
            if not -300 <= age <= 86400:
                raise ValueError("Message timestamp outside the replay window")
            text = "\n".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
            text = re.sub(r"^@" + re.escape(env.target) + r"\s+", "", text).strip()
            if not 1 <= len(text) <= 16000:
                raise ValueError("Empty or oversized text")
        except Exception:
            raise WorkflowError("INVALID_INPUT", "Send a recent chat message with 1–16000 text characters") from None
        key = digest([env.sender, str(env.session)])
        self.security.limit("agentverse:sender:" + digest(env.sender), 60, 60)
        if not self.slots.acquire(blocking=False):
            raise WorkflowError("RATE_LIMITED", "Agent is busy; retry this message later", 429)
        try:
            self.pool.submit(self.process, role, env, msg, key, text)
        except Exception:
            self.slots.release()
            raise
        return {"status": "accepted"}

    def deliver(self, role, env, msg):
        # Never take a callback URL, user identity or session from the message text.
        return self.send(destination=env.sender, msg=msg, sender=self.identities[role],
                         session_id=env.session, timeout=10, track_interaction=False)

    def process(self, role, env, msg, key, text):
        from uagents_core.contrib.protocols.chat import ChatMessage, ChatAcknowledgement, TextContent
        try:
            try:
                self.deliver(role, env, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
            except Exception:
                pass  # A failed ACK does not retry model calls or lose the durable result.
            with self.locks[int(key[:8], 16) % len(self.locks)]:
                reply = self.run_once(role, key, str(msg.msg_id), text)
            self.deliver(role, env, ChatMessage(content=[TextContent(type="text", text=reply)]))
        except Exception:
            # Provider/transport exceptions can contain credentials or private text.
            pass
        finally:
            self.slots.release()

    def run_once(self, role, key, message_id, text):
        receipt = digest([role, key, message_id])
        fingerprint = digest(text)
        busy = "A previous action is still being saved. Use /status shortly; no new action was applied."
        with self.store.transaction() as db:
            # Also serialize sessions across processes. No model calls happen under this lease.
            db.execute("DELETE FROM agentverse_locks WHERE expires_at<?", (time.time(),))
            lock = db.execute("INSERT INTO agentverse_locks VALUES(?,?) ON CONFLICT(session_key) DO NOTHING", (key, time.time() + 120))
            if not lock.rowcount:
                return busy
        try:
            # Recovery revokes the old token, including access to cached private replies.
            binding = self.chat.binding(key)
            if binding:
                try:
                    self.chat.view(binding)
                except WorkflowError:
                    return "This chat's membership is no longer valid. Use your latest recovery code in a new private chat."
            with self.store.transaction() as db:
                db.execute("DELETE FROM agentverse_receipts WHERE created_at<?", (time.time() - 7 * 86400,))
                row = db.execute("SELECT fingerprint,reply FROM agentverse_receipts WHERE receipt_key=?", (receipt,)).fetchone()
                if row:
                    if row["fingerprint"] != fingerprint:
                        return "This message ID was already used with different content. No action was applied."
                    return self.chat.unseal(row["reply"])["text"] if row["reply"] else "This action was already received. Its outcome needs checking with /status; it will not be repeated automatically."
                db.execute("INSERT INTO agentverse_receipts VALUES(?,?,NULL,?)", (receipt, fingerprint, time.time()))
            try:
                reply = self.chat.handle(role, key, message_id, text)
            except WorkflowError as exc:
                reply = exc.message + "\nUse /status to check the current step."
            except Exception:
                reply = "The action could not be confirmed. Use /status to check saved state before trying again. No automatic approval or model retry was made."
            with self.store.transaction() as db:
                db.execute("UPDATE agentverse_receipts SET reply=? WHERE receipt_key=?", (self.chat.seal({"text": reply}), receipt))
            return reply
        finally:
            with self.store.transaction() as db:
                db.execute("DELETE FROM agentverse_locks WHERE session_key=?", (key,))
