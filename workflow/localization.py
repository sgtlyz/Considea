"""Cached display translations of authorized room content; never change workflow evidence."""
import hashlib
import json
import re
import threading
from collections import defaultdict

from .engine import WorkflowError
from .store import Store


def strings(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
    elif isinstance(value, str):
        yield value
        if "\nAnswer: " in value:
            yield value.split("\nAnswer: ", 1)[1]
        if value[:1] in ("{", "["):
            try:
                parsed = json.loads(value)
            except ValueError:
                return
            if isinstance(parsed, (dict, list)):
                yield from strings(parsed)


def batches(texts):
    """Keep each model response below the established output limit."""
    batch, size = [], 0
    for index, text in enumerate(texts):
        # Long paragraphs are display data, never instructions. Bound each piece.
        pieces = []
        while len(text) > 1600:
            boundaries = [m.end() for m in re.finditer(r"\s+", text[:1600]) if m.end() >= 800]
            end = boundaries[-1] if boundaries else 1600
            pieces.append(text[:end])
            text = text[end:]
        if text:
            pieces.append(text)
        for part, piece in enumerate(pieces):
            if batch and (size + len(piece) > 3200 or len(batch) >= 8):
                yield batch
                batch, size = [], 0
            batch.append({"key": f"{index}:{part}", "text": piece})
            size += len(piece)
    if batch:
        yield batch


class Localization:
    def __init__(self, workflow):
        self.workflow = workflow
        self.locks = defaultdict(threading.Lock)

    def translate(self, token, room_id, requested):
        if (not isinstance(requested, list) or not 1 <= len(requested) <= 16
                or any(not isinstance(t, str) or not t.strip() or len(t) > 12000 for t in requested)
                or sum(map(len, requested)) > 24000):
            raise WorkflowError("INVALID_INPUT", "Invalid translation batch")
        texts = list(dict.fromkeys(requested))
        def authorized():
            view = self.workflow.view(token, room_id)
            if not set(texts) <= set(strings(view)):
                raise WorkflowError("UNAUTHORIZED", "Only visible room content can be translated", 403)
            return view
        authorized()
        with self.locks[room_id]:
            authorized()  # Recheck after waiting; private data can leave the shared projection.
            result, missing = {}, []
            with self.workflow.store.transaction() as db:
                for text in texts:
                    key = hashlib.sha256(text.encode()).hexdigest()
                    row = db.execute("SELECT translated FROM display_translations WHERE room_id=? AND source_hash=? AND language='zh'",
                                     (room_id, key)).fetchone()
                    if row:
                        result[text] = row["translated"]
                    else:
                        missing.append(text)
            pieces = defaultdict(list)
            for batch in batches(missing):
                security = getattr(self.workflow, "security", None)
                if security:
                    with self.workflow.store.transaction() as db:
                        state = Store.load(db, room_id)
                        if not security.consume(db, "translation:"+room_id, 160, 86400) or not security.reserve(db, state):
                            raise WorkflowError("BUDGET_LIMIT", "Translation allowance is unavailable", 429)
                try:
                    runner = self.workflow.runner
                    if hasattr(runner, "translate"):
                        translated = runner.translate(room_id, batch)
                    elif runner.mode == "mock":
                        translated = [{"key": x["key"], "text": "练习模式：此处为中文示例内容。"} for x in batch]
                    else:
                        raise ValueError("No translation runtime")
                    if (not isinstance(translated, list) or len(translated) != len(batch)
                            or {x.get("key") for x in translated} != {x["key"] for x in batch}
                            or any(not isinstance(x.get("text"), str) or not re.search(r"[\u3400-\u9fff]", x["text"]) for x in translated)):
                        raise ValueError("Invalid translation result")
                except Exception:
                    raise WorkflowError("TRANSLATION_UNAVAILABLE", "Chinese content could not be prepared", 503) from None
                for item in translated:
                    index, part = map(int, item["key"].split(":"))
                    pieces[index].append((part, item["text"]))
            authorized()  # A rotated credential or newly private source cannot use an in-flight result.
            with self.workflow.store.transaction() as db:
                for index, source in enumerate(missing):
                    text = "\n".join(t for _, t in sorted(pieces[index]))
                    result[source] = text
                    db.execute("INSERT INTO display_translations(room_id,source_hash,language,translated) VALUES(?,?,'zh',?) ON CONFLICT(room_id,source_hash,language) DO NOTHING",
                               (room_id, hashlib.sha256(source.encode()).hexdigest(), text))
            return {"translations": [{"source": source, "text": result[source]} for source in texts]}
