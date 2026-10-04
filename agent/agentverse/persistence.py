"""Short durable transactions; no database lock is held during network calls."""
import json
import time
from workflow.store import Store


class GatewayStore:
    def __init__(self, store, cipher=None, owned=False):
        self.store, self.cipher, self.owned = store, cipher, owned
        with store.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS av_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS av_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, digest TEXT NOT NULL, result TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS av_transfers (hash TEXT PRIMARY KEY, role TEXT NOT NULL, data TEXT NOT NULL, expires DOUBLE PRECISION NOT NULL)")

    def encode(self, value):
        data = json.dumps(value, ensure_ascii=False)
        return self.cipher.encrypt(data.encode()).decode() if self.cipher else data

    def decode(self, data):
        return json.loads(self.cipher.decrypt(data.encode()).decode() if self.cipher else data)

    def reserve(self, sid, mid, digest):
        with self.store.transaction() as db:
            row = db.execute("SELECT digest,result FROM av_messages WHERE id=?", (mid,)).fetchone()
            if row:
                if row["digest"] != digest:
                    return "Message ID conflict; no action taken."
                return self.decode(row["result"]) if row["result"] else "The earlier operation has an uncertain outcome. It will not be replayed automatically. Use /status."
            count = db.execute("SELECT COUNT(*) AS n FROM av_messages WHERE session_id=?", (sid,)).fetchone()["n"]
            if count >= 500:
                return "Conversation limit reached. Use a new private conversation and a fresh invitation or handoff."
            db.execute("INSERT INTO av_messages VALUES(?,?,?,NULL)", (mid, sid, digest))
            return None

    def session(self, sid):
        with self.store.transaction() as db:
            row = db.execute("SELECT data FROM av_sessions WHERE id=?", (sid,)).fetchone()
            return self.decode(row["data"]) if row else {}

    def complete(self, sid, mid, session, result):
        with self.store.transaction() as db:
            db.execute("INSERT INTO av_sessions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", (sid, self.encode(session)))
            db.execute("UPDATE av_messages SET result=? WHERE id=?", (self.encode(result), mid))

    def transfer(self, key, role, session):
        with self.store.transaction() as db:
            db.execute("DELETE FROM av_transfers WHERE expires<?", (time.time(),))
            db.execute("INSERT INTO av_transfers VALUES(?,?,?,?)", (key, role, self.encode(session), time.time() + 600))

    def resume(self, key, role):
        with self.store.transaction() as db:
            row = db.execute("SELECT role,data,expires FROM av_transfers WHERE hash=?", (key,)).fetchone()
            if not row or row["role"] != role or row["expires"] < time.time():
                raise ValueError("Invalid transfer")
            result = self.decode(row["data"])
            db.execute("DELETE FROM av_transfers WHERE hash=?", (key,))
            return result

    def close(self):
        if self.owned:
            self.store.close()
