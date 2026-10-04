"""Identity rotation, credential isolation and durable spending limits."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from cryptography.fernet import Fernet
from workflow.agents import MockRunner
from workflow.engine import Workflow, WorkflowError
from workflow.security import RoomSecurity
from workflow.store import Store

class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/"state.sqlite3"
        self.workflow = Workflow(Store(self.path), MockRunner())
        self.workflow.runner.mode = "integrated"
        self.env = {"CONCLAVE_SECRET_KEY": Fernet.generate_key().decode(),
                    "CONCLAVE_DEMO_ACCESS_CODE": "test-access-code", "CONCLAVE_SHARED_DAILY_CALLS": "2"}
        self.security = RoomSecurity(self.workflow,self.env)
        self.workflow.security = self.security
        self.context = {"member_ids":["alice","bob"],"hackathon_context":"Security test",
                        "deadline_at":None,"constraints":[]}
    def tearDown(self):
        self.temp.cleanup()
    def room(self, keys=None):
        prepared = self.security.prepare(keys,"test-access-code")
        return self.workflow.create_room(self.context,provision=self.security.provision(prepared))
    def test_recovery_revokes_old_session_and_old_code(self):
        room=self.room(); rid=room["room_id"]
        joined=self.workflow.join(rid,room["invitations"]["alice"])
        with self.assertRaises(WorkflowError):
            self.workflow.recover(rid,"member","bob",joined["recovery_code"])
        new=self.workflow.recover(rid,"member","alice",joined["recovery_code"])
        self.assertEqual(self.workflow.view(new["token"],rid)["actor"]["member_id"],"alice")
        with self.assertRaises(WorkflowError): self.workflow.view(joined["token"],rid)
        with self.assertRaises(WorkflowError): self.workflow.recover(rid,"member","alice",joined["recovery_code"])
        admin=self.workflow.recover(rid,"admin","",room["admin_recovery_code"])
        self.assertEqual(self.workflow.view(admin["token"],rid)["actor"]["role"],"admin")
        with self.assertRaises(WorkflowError): self.workflow.view(room["admin_token"],rid)
    def test_invitation_rotation_cannot_take_over_joined_identity(self):
        room=self.room(); rid=room["room_id"]
        invite=self.workflow.reissue_invitation(room["admin_token"],rid,"alice")
        with self.assertRaises(WorkflowError): self.workflow.join(rid,room["invitations"]["alice"])
        joined=self.workflow.join(rid,invite["invitation"])
        # Older rooms can have credentials but no recovery record.
        with self.workflow.store.transaction() as db:
            db.execute("DELETE FROM recovery WHERE room_id=? AND role='member'",(rid,))
        with self.assertRaises(WorkflowError): self.workflow.reissue_invitation(room["admin_token"],rid,"alice")
        with self.assertRaises(WorkflowError): self.workflow.reissue_invitation(joined["token"],rid,"bob")
    def test_keys_are_encrypted_room_bound_and_never_in_views_or_tasks(self):
        keys={"deepseek_api_key":"test-deepseek-private-A", "tavily_api_key":"test-tavily-private-A"}
        a=self.room(keys); b=self.room({"deepseek_api_key":"test-deepseek-private-B"})
        self.assertEqual(self.security.credentials_for(a["room_id"])["DEEPSEEK_API_KEY"],keys["deepseek_api_key"])
        self.assertEqual(self.security.credentials_for(b["room_id"])["TAVILY_API_KEY"],"")
        with self.workflow.store.transaction() as db:
            for table in ("rooms","tasks","shared_outbox","room_keys"):
                rows=db.execute("SELECT * FROM "+table).fetchall()
                self.assertNotIn(keys["deepseek_api_key"],str([dict(r) for r in rows]))
            encrypted=db.execute("SELECT encrypted FROM room_keys WHERE room_id=?",(a["room_id"],)).fetchone()[0]
            db.execute("UPDATE room_keys SET encrypted=? WHERE room_id=?",(encrypted,b["room_id"]))
        self.assertNotIn(keys["deepseek_api_key"],json.dumps(self.workflow.view(a["admin_token"],a["room_id"])))
        with self.assertRaises(WorkflowError): self.security.credentials_for(b["room_id"])
    def test_key_removal_pauses_without_falling_back_to_shared_key(self):
        room=self.room({"deepseek_api_key":"test-deepseek-private"}); rid=room["room_id"]
        joined=self.workflow.join(rid,room["invitations"]["alice"])
        with self.assertRaises(WorkflowError): self.security.set_keys(joined["token"],rid,None)
        self.security.set_keys(room["admin_token"],rid,None)
        self.assertIsNone(self.workflow.claim(rid))
        self.assertEqual(self.workflow.view(room["admin_token"],rid)["paused_reason"],"credentials")
        with self.assertRaises(WorkflowError): self.security.credentials_for(rid)
        self.security.set_keys(room["admin_token"],rid,{"deepseek_api_key":"test-replacement-private"})
        self.assertIsNotNone(self.workflow.claim(rid))
    def test_openai_room_keys_switch_all_agents_without_leaking_or_using_shared_keys(self):
        keys = {"provider": "openai", "openai_api_key": "sk-test-private-openai", "model": "gpt-4.1-mini",
                "tavily_api_key": "test-private-tavily"}
        room = self.room(keys)
        rid = room["room_id"]
        env = self.security.credentials_for(rid)
        self.assertEqual(env["PI_PROVIDER"], "openai")
        self.assertEqual(env["EVALUATOR_PROVIDER"], "openai")
        self.assertEqual(env["OPENAI_API_KEY"], keys["openai_api_key"])
        self.assertEqual(env["OPENAI_MODEL"], "gpt-4.1-mini")
        self.assertEqual(env["EVALUATOR_MODEL"], "gpt-4.1-mini")
        self.assertEqual(env["DEEPSEEK_API_KEY"], "")
        self.assertEqual(env["TAVILY_API_KEY"], keys["tavily_api_key"])
        with self.workflow.store.transaction() as db:
            for table in ("rooms", "tasks", "shared_outbox", "room_keys"):
                self.assertNotIn(keys["openai_api_key"], str([dict(r) for r in db.execute("SELECT * FROM " + table)]))
        self.assertNotIn(keys["openai_api_key"], json.dumps(self.workflow.view(room["admin_token"], rid)))
        self.security.set_keys(room["admin_token"], rid, {"deepseek_api_key": "test-private-deepseek"})
        env = self.security.credentials_for(rid)
        self.assertEqual(env["PI_PROVIDER"], "deepseek")
        self.assertEqual(env["OPENAI_API_KEY"], "")
        self.assertEqual(env["TAVILY_API_KEY"], "")

    def test_openai_model_can_come_from_server_config_but_not_deepseek_config(self):
        keys = {"provider": "openai", "openai_api_key": "sk-test-private-openai"}
        with self.assertRaises(WorkflowError):
            self.security.prepare(keys, "")
        security = RoomSecurity(self.workflow, {**self.env, "OPENAI_MODEL": "gpt-4.1-mini"})
        self.assertEqual(security.prepare(keys, "")["keys"]["model"], "gpt-4.1-mini")
        for invalid in ({**keys, "model": "https://untrusted.example"}, {**keys, "model": "invalid model"},
                        {**keys, "provider": "unknown", "model": "gpt-4.1-mini"},
                        {"provider": "openai", "deepseek_api_key": "test-private-deepseek", "model": "gpt-4.1-mini"}):
            with self.assertRaises(WorkflowError):
                security.prepare(invalid, "")

    def test_legacy_encrypted_deepseek_keys_still_work_after_openai_is_added(self):
        room = self.room()
        rid = room["room_id"]
        old_keys = {"deepseek_api_key": "test-legacy-private-key", "tavily_api_key": "test-legacy-tavily-key"}
        encrypted = self.security.cipher.encrypt(json.dumps({"room_id": rid, "keys": old_keys}).encode()).decode()
        with self.workflow.store.transaction() as db:
            db.execute("UPDATE room_keys SET funding='own', encrypted=? WHERE room_id=?", (encrypted, rid))
        env = self.security.credentials_for(rid)
        self.assertEqual(env["PI_PROVIDER"], "deepseek")
        self.assertEqual(env["DEEPSEEK_API_KEY"], "test-legacy-private-key")
        self.assertEqual(env["TAVILY_API_KEY"], "test-legacy-tavily-key")
        self.assertEqual(env["OPENAI_API_KEY"], "")

    def test_existing_deepseek_evaluator_overrides_are_preserved_without_inheriting_openai_overrides(self):
        room = self.room({"deepseek_api_key": "test-private-deepseek"})
        configured = {**self.env, "PI_PROVIDER": "deepseek", "DEEPSEEK_MODEL": "deepseek-flash",
                      "EVALUATOR_PROVIDER": "deepseek", "EVALUATOR_MODEL": "deepseek-chat",
                      "EVALUATOR_BASE_URL": "https://api.deepseek.com/v1"}
        security = RoomSecurity(self.workflow, configured)
        env = security.credentials_for(room["room_id"])
        self.assertEqual(env["DEEPSEEK_MODEL"], "deepseek-flash")
        self.assertEqual(env["EVALUATOR_MODEL"], "deepseek-chat")
        self.assertEqual(env["EVALUATOR_BASE_URL"], "https://api.deepseek.com/v1")
        security = RoomSecurity(self.workflow, {**configured, "PI_PROVIDER": "openai",
                                               "EVALUATOR_PROVIDER": "openai", "EVALUATOR_MODEL": "gpt-4.1-mini"})
        self.assertEqual(security.credentials_for(room["room_id"])["EVALUATOR_MODEL"], "deepseek-flash")
        self.assertEqual(security.credentials_for(room["room_id"])["EVALUATOR_BASE_URL"], "")

    def test_openai_key_replacement_preserves_tavily_requirement_and_admin_only_access(self):
        room = self.room({"deepseek_api_key": "test-private-deepseek", "tavily_api_key": "test-private-tavily"})
        rid = room["room_id"]
        joined = self.workflow.join(rid, room["invitations"]["alice"])
        keys = {"provider": "openai", "openai_api_key": "sk-test-private-openai", "model": "gpt-4.1-mini"}
        with self.assertRaises(WorkflowError):
            self.security.set_keys(joined["token"], rid, keys)
        with self.workflow.store.transaction() as db:
            state = self.workflow._room(db, rid)
            state["config"]["search_enabled"] = True
            Store.save(db, state)
        with self.assertRaises(WorkflowError):
            self.security.set_keys(room["admin_token"], rid, keys)
        self.security.set_keys(room["admin_token"], rid, {**keys, "tavily_api_key": "test-private-tavily"})
        self.assertEqual(self.security.credentials_for(rid)["TAVILY_API_KEY"], "test-private-tavily")
    def test_access_gate_and_key_validation(self):
        for code in ("", "wrong", None):
            with self.assertRaises(WorkflowError): self.security.prepare(None,code)
        for keys in ({}, {"deepseek_api_key":"short"}, {"deepseek_api_key":"invalid with space"}, {"OPENAI_API_KEY":"not-supported"}):
            with self.assertRaises(WorkflowError): self.security.prepare(keys,"")
        self.assertEqual(self.security.prepare({"deepseek_api_key":"test-valid-key"},"")["funding"],"own")
        with self.assertRaises(WorkflowError): RoomSecurity(self.workflow,{}).prepare({"deepseek_api_key":"test-valid-key"},"")
    def test_concurrent_limits_persist_across_restart(self):
        successes=[]
        def reserve():
            try: self.security.limit("shared-test",3,3600); successes.append(True)
            except WorkflowError: pass
        threads=[threading.Thread(target=reserve) for _ in range(10)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(len(successes),3)
        restarted=RoomSecurity(Workflow(Store(self.path),MockRunner()),self.env)
        with self.assertRaises(WorkflowError): restarted.limit("shared-test",3,3600)
        with patch("workflow.security.time.time",return_value=5000000000):
            restarted.limit("different-client",1,60)
            with restarted.workflow.store.transaction() as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM usage_limits WHERE scope='shared-test'").fetchone()[0],0)
    def test_shared_budget_holds_pending_tasks(self):
        room=self.room(); rid=room["room_id"]
        self.assertIsNotNone(self.workflow.claim(rid))
        self.assertIsNotNone(self.workflow.claim(rid))
        another=self.room()
        self.assertIsNone(self.workflow.claim(another["room_id"]))
        self.assertEqual(self.workflow.view(another["admin_token"],another["room_id"])["paused_reason"],"daily_limit")
    def test_away_member_remains_required(self):
        room=self.room(); rid=room["room_id"]
        joined=self.workflow.join(rid,room["invitations"]["alice"])
        before=self.workflow.view(joined["token"],rid)
        self.workflow.set_presence(joined["token"],rid,False)
        after=self.workflow.view(joined["token"],rid)
        self.assertEqual(after["phase"],before["phase"])
        self.assertFalse(after["members"]["alice"]["available"])
        self.assertIn("alice",after["members"])
        self.assertEqual(after["votes"],{})

if __name__ == "__main__": unittest.main()
