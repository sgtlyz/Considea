import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const data = JSON.parse(await readFile(new URL('../../workflow/web/demo-data.json', import.meta.url), 'utf8'));
const zh = JSON.parse(await readFile(new URL('../../workflow/web/demo-zh.json', import.meta.url), 'utf8'));

test('the simulated story does not claim a recorded run or verified research', () => {
  assert.equal(data.content_type, 'illustrative_simulation');
  assert.equal(data.recorded_at, undefined);
  assert.equal(data.model, undefined);
  for (const step of data.steps.filter(s => s.report)) {
    assert.match(step.report.basis, /Simulated/);
    for (const assessment of Object.values(step.report.tests)) {
      assert.equal(assessment.result, 'insufficient_evidence');
      assert.ok(assessment.missing_information.length);
    }
  }
});

test('every round advances with distinct participant answers and an explicit outcome', () => {
  const seen = new Set();
  const rounds = data.steps.filter(s => s.kind.startsWith('discussion_round_'));
  assert.equal(rounds.length, 4);
  for (const step of data.steps) {
    assert.ok(step.outcome);
    assert.ok(step.dialogue.some(t => t.speaker === 'Alice'));
    assert.ok(step.dialogue.some(t => t.speaker === 'Bob'));
    for (const turn of step.dialogue) {
      assert.ok(!seen.has(turn.text), `Repeated dialogue: ${turn.text}`);
      seen.add(turn.text);
    }
  }
  assert.equal(data.steps.find(s => s.kind === 'candidate_review').candidate.version, 1);
  assert.equal(data.steps.find(s => s.kind === 'revision').candidate.version, 2);
  const ending = data.steps.at(-1);
  assert.equal(ending.kind, 'accepted');
  for (const member of ['Alice', 'Bob']) {
    assert.match(ending.dialogue.find(t => t.speaker === member).text, /accept version 2/);
  }
  assert.ok(ending.deliverables.length > 0);
});

test('all story text has a Chinese translation, including revisions and the final brief', () => {
  const metadata = new Set(['kind', 'speaker', 'content_type', 'updated_at', 'result']);
  function check(value, key) {
    if (typeof value === 'string' && !metadata.has(key)) {
      assert.ok(zh[value], `Missing translation: ${value}`);
      assert.match(zh[value], /[\u3400-\u9fff]/);
    } else if (Array.isArray(value)) {
      value.forEach(item => check(item, key));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => check(item, key));
    }
  }
  check(data);
});
