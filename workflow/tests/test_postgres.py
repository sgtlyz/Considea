"""Run with an explicit disposable PostgreSQL URL; never use the production schema."""
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from workflow.store import PostgresStore
from workflow.tests import test_workflow as workflow_cases


@unittest.skipUnless(os.environ.get("CONCLAVE_TEST_POSTGRES_URL"), "Set a disposable PostgreSQL test URL")
class PostgresTests(unittest.TestCase):
    def setUp(self):
        self.url = os.environ["CONCLAVE_TEST_POSTGRES_URL"]
        self.schema = "test_" + uuid4().hex
        self.store = PostgresStore(self.url, self.schema)
        self.addCleanup(self.cleanup_database)

    def cleanup_database(self):
        import psycopg
        self.store.close()
        # Only the random schema created by this test can be removed.
        assert self.schema.startswith("test_") and len(self.schema) == 37
        with psycopg.connect(self.url) as db:
            db.execute(f'DROP SCHEMA "{self.schema}" CASCADE')

    def exercise(self, name):
        test = workflow_cases.WorkflowTests(name)
        with patch("workflow.tests.test_workflow.Store", return_value=self.store):
            test.setUp()
        try:
            getattr(test, name)()
        finally:
            test.tearDown()

    def test_complete_workflow(self):
        self.exercise("test_complete_path_requires_real_answers_and_unanimous_accept")

    def test_concurrent_claims(self):
        self.exercise("test_concurrent_workers_claim_each_initial_task_once")

    def test_restart_and_rollback(self):
        from workflow.engine import Workflow
        from workflow.agents import MockRunner
        context = {"member_ids": ["alice", "bob"], "hackathon_context": "Durability test",
                   "deadline_at": None, "constraints": []}
        first = Workflow(self.store, MockRunner())
        room = first.create_room(context)
        joined = first.join(room["room_id"], room["invitations"]["alice"])
        first.run_once(room["room_id"])
        before = first.view(joined["token"], room["room_id"])
        with self.assertRaises(RuntimeError):
            with self.store.transaction() as db:
                db.execute("DELETE FROM rooms WHERE id=?", (room["room_id"],))
                raise RuntimeError("Crash before commit")
        self.store.close()
        self.store = PostgresStore(self.url, self.schema)
        restored = Workflow(self.store, MockRunner()).view(joined["token"], room["room_id"])
        self.assertEqual(restored, before)
        with self.store.transaction() as db:
            row = db.execute("SELECT lease_until FROM tasks WHERE lease_until IS NOT NULL").fetchone()
            if row:
                self.assertGreater(row[0], 1_000_000_000)


if __name__ == "__main__":
    unittest.main()
