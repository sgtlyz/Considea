import json
import threading
import unittest
from unittest.mock import patch

from workflow.engine import WorkflowError
from workflow.localization import Localization, batches
from workflow.store import Store
from workflow.tests import test_workflow as base


class LocalizationTests(unittest.TestCase):
    setUp = base.WorkflowTests.setUp
    tearDown = base.WorkflowTests.tearDown
    view = base.WorkflowTests.view
    drain = base.WorkflowTests.drain
    def prepare(self):
        self.drain()
        with self.engine.store.transaction() as db:
            state = Store.load(db, self.room)
            state["members"]["alice"]["question_batch"]["questions"][0]["text"] = "PRIVATE-ALICE: I can spend 24 hours, but cannot build a wearable."
            state["members"]["bob"]["question_batch"]["questions"][0]["text"] = "PRIVATE-BOB: Camera prototype"
            Store.save(db, state)
        self.localization = Localization(self.engine)
        self.text = self.view()["private"]["question_batch"]["questions"][0]["text"]

    def test_private_text_requires_current_authorization_even_on_cache_hit(self):
        self.prepare()
        calls=[]
        def translate(room, batch):
            calls.append(batch)
            return [{"key": t["key"], "text": "我可以投入 24 小时，但不能制作可穿戴设备。"} for t in batch]
        self.runner.translate=translate
        value=self.localization.translate(self.tokens["alice"],self.room,[self.text])
        self.assertIn("24",value["translations"][0]["text"])
        self.localization.translate(self.tokens["alice"],self.room,[self.text])
        self.assertEqual(len(calls),1)
        for token in [self.tokens["bob"],self.created["admin_token"]]:
            with self.assertRaises(WorkflowError) as error:
                self.localization.translate(token,self.room,[self.text])
            self.assertEqual(error.exception.code,"UNAUTHORIZED")
        self.assertEqual(len(calls),1)
        self.assertEqual(self.view()["private"]["question_batch"]["questions"][0]["text"],self.text)
        with self.engine.store.transaction() as db:
            self.assertNotIn("PRIVATE-ALICE",db.execute("SELECT snapshot FROM shared_outbox").fetchone()[0])

    def test_rejects_invented_text_and_rechecks_revoked_access_after_model_call(self):
        self.prepare()
        with self.assertRaises(WorkflowError):
            self.localization.translate(self.tokens["alice"],self.room,["This is not room content"])
        def translate(room,batch):
            with self.engine.store.transaction() as db:
                db.execute("DELETE FROM credentials WHERE room_id=? AND member_id='alice'",(room,))
            return [{"key":t["key"],"text":"中文内容"} for t in batch]
        self.runner.translate=translate
        with self.assertRaises(WorkflowError):
            self.localization.translate(self.tokens["alice"],self.room,[self.text])
        with self.engine.store.transaction() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM display_translations").fetchone()[0],0)

    def test_restart_cache_and_concurrent_refresh_do_not_repeat_model_calls(self):
        self.prepare()
        calls=[]
        self.runner.translate=lambda room,batch:(calls.append(batch) or [{"key":t["key"],"text":"中文内容"} for t in batch])
        errors=[]
        def run():
            try:self.localization.translate(self.tokens["alice"],self.room,[self.text])
            except Exception as e:errors.append(e)
        threads=[threading.Thread(target=run) for _ in range(4)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertFalse(errors);self.assertEqual(len(calls),1)
        Localization(self.engine).translate(self.tokens["alice"],self.room,[self.text])
        self.assertEqual(len(calls),1)

    def test_invalid_output_is_not_cached_and_batches_bound_output(self):
        self.prepare()
        self.runner.translate=lambda room,batch:[]
        with self.assertRaises(WorkflowError) as error:self.localization.translate(self.tokens["alice"],self.room,[self.text])
        self.assertEqual(error.exception.code,"TRANSLATION_UNAVAILABLE")
        with self.engine.store.transaction() as db:self.assertEqual(db.execute("SELECT count(*) FROM display_translations").fetchone()[0],0)
        pieces=list(batches(["x"*5000,"y"*1000]))
        self.assertTrue(all(sum(len(t["text"]) for t in batch)<=3200 for batch in pieces))
        self.assertEqual(''.join(t["text"] for batch in pieces for t in batch),'x'*5000+'y'*1000)
