"""SQLite storage. Each mutation is a short transaction; model calls run outside it."""
import contextlib
import hashlib
import json
import sqlite3
from pathlib import Path


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


def token_hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.transaction() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, state TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS credentials (
                    token_hash TEXT PRIMARY KEY, room_id TEXT NOT NULL,
                    role TEXT NOT NULL, member_id TEXT);
                CREATE TABLE IF NOT EXISTS invitations (
                    token_hash TEXT PRIMARY KEY, room_id TEXT NOT NULL,
                    member_id TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS events (
                    room_id TEXT NOT NULL, event_id TEXT NOT NULL,
                    actor TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
                    event TEXT NOT NULL, received_at TEXT NOT NULL,
                    PRIMARY KEY(room_id,event_id));
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, member_id TEXT,
                    operation TEXT NOT NULL, request TEXT NOT NULL, dependencies TEXT NOT NULL,
                    status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                    lease_token TEXT, lease_until REAL, result TEXT, error TEXT,
                    created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS shared_outbox (
                    room_id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
                    idea_revision INTEGER NOT NULL, snapshot TEXT NOT NULL,
                    delivered_revision INTEGER NOT NULL DEFAULT -1);
                CREATE INDEX IF NOT EXISTS task_status ON tasks(status,created_at);
            """)

    @contextlib.contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=15000")
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def load(db, room_id):
        row = db.execute("SELECT state FROM rooms WHERE id=?", (room_id,)).fetchone()
        return json.loads(row["state"]) if row else None

    @staticmethod
    def save(db, state):
        state["revision"] += 1
        db.execute("UPDATE rooms SET state=? WHERE id=?", (encode(state), state["room_id"]))

        # Updated in the same transaction as state; a crash cannot lose the sync intent.
        shared = {key: state[key] for key in (
            "room_id", "revision", "discussion_round", "phase", "mode", "room_context", "config",
            "paused_reason", "calls_started", "difference", "answers", "votes", "convergence_decision",
            "candidates", "evaluations", "reviews", "candidate_history", "selected_candidate_ref")}
        shared["agent_runtime"] = state.get("agent_runtime", {})
        shared["shared_context"] = {"profiles": [m["profile"] for m in state["members"].values() if m["profile"]],
                                    "sources": state["sources"], "discussion_history": state["discussion_history"]}
        shared["members"] = {mid: {"stage": m["stage"], "approved_round": m["approved_round"]}
                             for mid, m in state["members"].items()}
        db.execute("""INSERT INTO shared_outbox(room_id,revision,idea_revision,snapshot) VALUES(?,?,?,?)
            ON CONFLICT(room_id) DO UPDATE SET revision=excluded.revision,
            idea_revision=excluded.idea_revision,snapshot=excluded.snapshot""",
            (state["room_id"], state["revision"], state.get("idea_revision", 0), encode(shared)))
