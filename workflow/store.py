"""Transactional storage; model calls always run outside the database transaction."""
import contextlib
import hashlib
import json
import os
import re
import sqlite3
from pathlib import Path


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


def token_hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Store:
    backend = "sqlite"

    @staticmethod
    def columns(db, table):
        return {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}

    def close(self):
        pass

    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def initialize(self):
        with self.transaction() as db:
            schema = """
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
                CREATE TABLE IF NOT EXISTS task_attempts (
                    task_id TEXT NOT NULL, attempt INTEGER NOT NULL,
                    outcome TEXT NOT NULL, started_at TEXT NOT NULL,
                    finished_at TEXT, error TEXT, result TEXT,
                    PRIMARY KEY(task_id,attempt));
                CREATE INDEX IF NOT EXISTS task_status ON tasks(status,created_at);
            """
            # Keep schema creation and additive migrations in the same write lock.
            for statement in schema.split(";"):
                if statement.strip():
                    db.execute(statement.replace("REAL", "DOUBLE PRECISION") if self.backend == "postgres" else statement)
            columns = self.columns(db, "tasks")
            for name, declaration in (("auto_retries", "INTEGER NOT NULL DEFAULT 0"),
                                      ("next_attempt_at", "REAL NOT NULL DEFAULT 0"),
                                      ("context", "TEXT")):
                if name not in columns:
                    db.execute(f"ALTER TABLE tasks ADD COLUMN {name} {declaration.replace('REAL', 'DOUBLE PRECISION') if self.backend == 'postgres' else declaration}")
            # Preserve pre-migration failure results before a future manual retry clears tasks.result.
            db.execute("""INSERT INTO task_attempts(task_id,attempt,outcome,started_at,error,result)
                SELECT id,attempts,status,created_at,error,result FROM tasks WHERE attempts > 0 ON CONFLICT DO NOTHING""")

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
        shared["evaluation_details"] = state.get("evaluation_details", {})
        shared["shared_context"] = {"profiles": [m["profile"] for m in state["members"].values() if m["profile"]],
                                    "sources": state["sources"], "discussion_history": state["discussion_history"]}
        shared["members"] = {mid: {"stage": m["stage"], "approved_round": m["approved_round"]}
                             for mid, m in state["members"].items()}
        db.execute("""INSERT INTO shared_outbox(room_id,revision,idea_revision,snapshot) VALUES(?,?,?,?)
            ON CONFLICT(room_id) DO UPDATE SET revision=excluded.revision,
            idea_revision=excluded.idea_revision,snapshot=excluded.snapshot""",
            (state["room_id"], state["revision"], state.get("idea_revision", 0), encode(shared)))


class Record(dict):
    """Named fields plus positional reads, matching sqlite3.Row for existing callers."""
    def __getitem__(self, key):
        return list(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


class PostgresConnection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, sql, parameters=()):
        # Queries are application-owned SQL; values are still passed separately to psycopg.
        return self.connection.execute(sql.replace("?", "%s"), parameters)


class PostgresStore(Store):
    backend = "postgres"

    def __init__(self, url, schema="public"):
        from psycopg_pool import ConnectionPool
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", schema):
            raise ValueError("Invalid database schema")
        self.schema = schema
        self.path = "postgres"  # Never retain a connection URL in public diagnostics.
        def row_factory(cursor):
            names = [column.name for column in cursor.description] if cursor.description else []
            return lambda values: Record(zip(names, values))
        self.pool = ConnectionPool(url, min_size=1, max_size=6, timeout=15,
                                   kwargs={"connect_timeout": 10, "row_factory": row_factory}, open=True)
        try:
            self.pool.wait(timeout=20)
            self.initialize()
        except BaseException:
            self.pool.close()
            raise

    def columns(self, db, table):
        return {r["name"] for r in db.execute(
            "SELECT column_name AS name FROM information_schema.columns WHERE table_schema=? AND table_name=?",
            (self.schema, table))}

    @contextlib.contextmanager
    def transaction(self):
        with self.pool.connection() as connection:
            with connection.transaction():
                connection.execute("SET LOCAL statement_timeout = '15s'")
                connection.execute("SET LOCAL lock_timeout = '15s'")
                # Match SQLite's writer serialization across workers AND service restarts.
                # No model calls hold this lock. Scale by room before adding many replicas.
                connection.execute("SELECT pg_advisory_xact_lock(726194830)")
                connection.execute(f'CREATE SCHEMA IF NOT EXISTS "{self.schema}"')
                connection.execute(f'SET LOCAL search_path TO "{self.schema}"')
                yield PostgresConnection(connection)

    def close(self):
        self.pool.close()


def configured_store(sqlite_path):
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return PostgresStore(url, os.environ.get("CONCLAVE_DB_SCHEMA", "public"))
    return Store(sqlite_path)
