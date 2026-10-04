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
