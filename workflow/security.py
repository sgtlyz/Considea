"""Room-scoped credentials and durable public-demo limits.

Raw keys live only in the encrypted row and the private per-call transport.
Neither room snapshots, task payloads, logs nor browser responses contain them.
"""
import hashlib
import json
import os
import secrets
import time
from datetime import datetime, timezone

from .engine import WorkflowError
from .store import Store, encode


class RoomSecurity:
    def __init__(self, workflow, env=None):
        self.workflow = workflow
        self.env = dict(os.environ if env is None else env)
        self.live = workflow.runner.mode == "integrated"
        key = self.env.get("CONCLAVE_SECRET_KEY")
        self.cipher = None
        if key:
            from cryptography.fernet import Fernet
            self.cipher = Fernet(key.encode())
        self.access_code = self.env.get("CONCLAVE_DEMO_ACCESS_CODE", "")
        self.daily_limit = int(self.env.get("CONCLAVE_SHARED_DAILY_CALLS", "120"))
        self.room_limit = int(self.env.get("CONCLAVE_ROOM_CALL_LIMIT", "80"))
        if not 1 <= self.daily_limit <= 10000 or not 1 <= self.room_limit <= 10000:
            raise ValueError("Call limits must be between 1 and 10000")

    def limit(self, scope, maximum, seconds):
        if maximum < 1:
            raise WorkflowError("RATE_LIMITED", "This action is temporarily unavailable", 429)
        with self.workflow.store.transaction() as db:
            if not self.consume(db, scope, maximum, seconds):
                raise WorkflowError("RATE_LIMITED", "Too many requests. Please wait before trying again.", 429)

    @staticmethod
    def consume(db, scope, maximum, seconds):
        period = int(time.time()) // seconds
        row = db.execute("SELECT used FROM usage_limits WHERE scope=? AND period=?", (scope, period)).fetchone()
        if row and row["used"] >= maximum:
            return False
        db.execute("INSERT INTO usage_limits(scope,period,used,expires_at) VALUES(?,?,1,?) ON CONFLICT(scope,period) DO UPDATE SET used=usage_limits.used+1", (scope, period, (period+2)*seconds))
        # Keep this finite even after repeated anonymous requests over many days.
        db.execute("DELETE FROM usage_limits WHERE expires_at<? OR expires_at IS NULL", (time.time(),))
        return True

    def prepare(self, credentials, access_code):
        if credentials is not None:
            return {"funding": "own", "keys": self.validate(credentials)}
        if self.live:
            if not self.access_code or not isinstance(access_code, str) or not secrets.compare_digest(access_code, self.access_code):
                raise WorkflowError("ACCESS_CODE_REQUIRED", "Enter the team demo access code or use your own API keys", 403)
        return {"funding": "team", "keys": None}

    def validate(self, keys):
        if not self.cipher:
            raise WorkflowError("KEY_STORAGE_UNAVAILABLE", "Encrypted key storage is not configured", 503)
        if not isinstance(keys, dict) or set(keys) - {"deepseek_api_key", "tavily_api_key"}:
            raise WorkflowError("INVALID_INPUT", "Only DeepSeek and Tavily keys are supported", 400)
        normalized = {}
        for name in ("deepseek_api_key", "tavily_api_key"):
            value = keys.get(name, "")
            if not isinstance(value,str) or (value and (not 10 <= len(value) <= 512 or any(c.isspace() or ord(c)<33 or ord(c)>126 for c in value))):
                raise WorkflowError("INVALID_INPUT", "Enter a valid key without spaces", 400)
            normalized[name] = value
        if not normalized["deepseek_api_key"]:
            raise WorkflowError("INVALID_INPUT", "A DeepSeek API key is required", 400)
        return normalized

    def provision(self, prepared):
        def save(db, room_id):
            encrypted = self.cipher.encrypt(encode({"room_id":room_id,"keys":prepared["keys"]}).encode()).decode() if prepared["keys"] else None
            db.execute("INSERT INTO room_keys VALUES(?,?,?,?)", (room_id,prepared["funding"],encrypted,datetime.now(timezone.utc).isoformat()))
        return save

    def set_keys(self, token, room_id, credentials):
        keys = self.validate(credentials) if credentials is not None else None
        with self.workflow.store.transaction() as db:
            self.workflow._auth(db,token,room_id,admin=True)
            state = self.workflow._room(db,room_id)
            if keys and state["config"]["search_enabled"] and not keys["tavily_api_key"]:
                raise WorkflowError("INVALID_INPUT", "This room uses web research; add a Tavily key too", 400)
            encrypted = self.cipher.encrypt(encode({"room_id":room_id,"keys":keys}).encode()).decode() if keys else None
            db.execute("INSERT INTO room_keys VALUES(?,'own',?,?) ON CONFLICT(room_id) DO UPDATE SET funding='own',encrypted=excluded.encrypted,updated_at=excluded.updated_at",
                       (room_id,encrypted,datetime.now(timezone.utc).isoformat()))
            if state["paused_reason"] in ("credentials", "daily_limit"):
                state["paused_reason"] = None if keys else "credentials"
                Store.save(db,state)
            return self.status(db,room_id,True)

    def credentials_for(self, room_id):
        with self.workflow.store.transaction() as db:
            row = db.execute("SELECT funding,encrypted FROM room_keys WHERE room_id=?",(room_id,)).fetchone()
        if not row or row["funding"] == "team":
            return None
        if not row["encrypted"] or not self.cipher:
            raise WorkflowError("ROOM_KEYS_REQUIRED", "Add room API keys before continuing", 409)
        try:
            data = json.loads(self.cipher.decrypt(row["encrypted"].encode()))
            if data["room_id"] != room_id:
                raise ValueError("Wrong room")
            keys = data["keys"]
        except Exception:
            raise WorkflowError("ROOM_KEYS_UNAVAILABLE", "Room keys could not be unlocked; save them again", 503) from None
        # Both keys are explicitly overridden, including an empty optional search key.
        return {"PI_PROVIDER":"deepseek", "EVALUATOR_PROVIDER":"deepseek",
                "DEEPSEEK_API_KEY":keys["deepseek_api_key"], "TAVILY_API_KEY":keys["tavily_api_key"]}

    def reserve(self, db, state):
        if not self.live:
            return True
        row = db.execute("SELECT funding,encrypted FROM room_keys WHERE room_id=?",(state["room_id"],)).fetchone()
        if row and row["funding"] == "own":
            if not row["encrypted"]:
                state["paused_reason"] = "credentials"
                return False
            return True
        if not self.consume(db,"shared-agent-calls",self.daily_limit,86400):
            state["paused_reason"] = "daily_limit"
            state["quota_reset_at"] = (int(time.time())//86400+1)*86400
            return False
        return True

    def status(self, db, room_id, admin):
        row = db.execute("SELECT funding,encrypted FROM room_keys WHERE room_id=?",(room_id,)).fetchone()
        result = {"funding":row["funding"] if row else "team", "keys_configured":bool(row and row["encrypted"]),
                  "can_manage_keys":admin, "own_keys_supported":bool(self.cipher)}
        if admin and result["funding"] == "team":
            used=db.execute("SELECT used FROM usage_limits WHERE scope='shared-agent-calls' AND period=?",(int(time.time())//86400,)).fetchone()
            result.update(shared_calls_remaining=max(0,self.daily_limit-(used["used"] if used else 0)),
                          shared_calls_limit=self.daily_limit)
        return result

    @staticmethod
    def client_scope(address):
        return hashlib.sha256(address.encode()).hexdigest()
