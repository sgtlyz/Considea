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

    def test_target_language_separates_cache_and_preserves_authorization(self):
        self.prepare()
        calls = []
        def translate(room, batch, language="zh"):
            calls.append(language)
            return [{"key": t["key"], "text": "English content 24" if language == "en" else "中文内容 24"} for t in batch]
        self.runner.translate = translate
        for language in ["zh", "en", "zh", "en"]:
            result = self.localization.translate(self.tokens["alice"], self.room, [self.text], language)
            self.assertIn("English" if language == "en" else "中文", result["translations"][0]["text"])
        self.assertEqual(calls, ["zh", "en"])
        with self.assertRaises(WorkflowError):
            self.localization.translate(self.tokens["bob"], self.room, [self.text], "en")
        with self.assertRaises(WorkflowError):
            self.localization.translate(self.tokens["alice"], self.room, [self.text], "fr")

    def test_translation_continues_beyond_legacy_daily_allowances(self):
        from workflow.security import RoomSecurity
        self.prepare()
        self.runner.mode = "integrated"
        self.engine.security = RoomSecurity(self.engine, {"CONCLAVE_SHARED_DAILY_CALLS": "1"})
        with self.engine.store.transaction() as db:
            for scope in ("shared-agent-calls", "translation:" + self.room):
                self.engine.security.consume(db, scope, None, 86400)
                db.execute("UPDATE usage_limits SET used=100001 WHERE scope=?", (scope,))
        self.runner.translate = lambda room, batch: [{"key": t["key"], "text": "中文内容 24"} for t in batch]
        result = self.localization.translate(self.tokens["alice"], self.room, [self.text])
        self.assertIn("24", result["translations"][0]["text"])
        self.assertIsNone(self.view()["paused_reason"])

    def test_english_rejects_untranslated_chinese_and_does_not_cache(self):
        self.prepare()
        self.runner.translate = lambda room, batch, language: [{"key": t["key"], "text": "仍然是中文"} for t in batch]
        with self.assertRaises(WorkflowError) as error:
            self.localization.translate(self.tokens["alice"], self.room, [self.text], "en")
        self.assertEqual(error.exception.code, "TRANSLATION_UNAVAILABLE")
        with self.engine.store.transaction() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM display_translations").fetchone()[0], 0)

    def test_http_language_reaches_real_node_translation_bridge(self):
        from urllib.request import Request, urlopen
        from workflow.server import make_server
        from workflow.integration import IntegratedRunner
        self.prepare()
        runner = IntegratedRunner(offline=True)
        self.engine.runner = runner
        server = make_server(self.engine, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for language in ["en", "zh"]:
                request = Request(
                    f"http://127.0.0.1:{server.server_address[1]}/api/rooms/{self.room}/translations",
                    data=json.dumps({"texts": [self.text], "language": language}).encode(),
                    headers={"Authorization": "Bearer " + self.tokens["alice"], "Content-Type": "application/json"})
                with urlopen(request) as response:
                    text = json.load(response)["translations"][0]["text"]
                self.assertIn("English" if language == "en" else "中文", text)
                self.assertIn("24", text)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
            runner.close()
