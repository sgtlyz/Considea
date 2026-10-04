import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore, InterviewSession, buildBrief } from './session.mjs';
import { createProtocolFixtureRuntime } from '../protocol-fixtures.mjs';

function setup() {
  const store = new JsonStore(mkdtempSync(join(tmpdir(), 'considea-test-')));
  const runtimeFor = op => createProtocolFixtureRuntime(op);
  return { store, runtimeFor, app: new InterviewSession({ store, runtimeFor, maxBatches: 2 }) };
}
const message = (text, id, overrides = {}) => ({ sender: 'sender-a', session_id: 'session-a', msg_id: id, text, ...overrides });
const key = JSON.stringify(['sender-a', 'session-a']);

test('default three-batch session stops without asking a fourth batch', async () => {
  const { store, runtimeFor } = setup();
  const app = new InterviewSession({ store, runtimeFor });
  assert.match((await app.handle(message('start', 'start'))).text, /1\/3/);
  for (let i = 1; i <= 3; i++) {
    assert.equal((await app.handle(message(`OFFLINE SAMPLE: answer ${i}`, `answer-${i}`))).ok, true);
  }
  const saved = store.read(key);
  assert.equal(saved.answered_batches, 3);
  assert.equal(saved.phase, 'review');
  assert.equal(saved.messages.filter(m => m.role === 'assistant').length, 3);
});

test('per-session rounds persist across restart, isolate senders, and configure without model work', async () => {
  const { store, runtimeFor } = setup();
  let calls = 0;
  const app = new InterviewSession({ store, runtimeFor: () => { calls++; throw new Error('No model calls expected'); } });
  const request = message('/rounds 7', 'configure');
  const result = await app.handle(request);
  assert.equal(result.ok, true);
  assert.deepEqual(await app.handle(request), result);
  assert.equal(calls, 0);
  assert.equal(store.read(key).answered_batches, 0);
  const restarted = new InterviewSession({ store, runtimeFor, maxBatches: 1 });
  assert.match((await restarted.handle(message('/rounds', 'show'))).text, /7 轮/);
  assert.match((await restarted.handle(message('/rounds', 'other', { sender: 'sender-b' }))).text, /1 轮/);
  assert.match((await restarted.handle(message('start', 'start'))).text, /1\/7/);
});

test('custom limit bounds, outstanding batch floor and finished sessions are enforced', async () => {
  const { app, store } = setup();
  for (const [i, value] of ['0', '8', '2.5', 'NaN', '1 extra'].entries()) {
    assert.equal((await app.handle(message(`/rounds ${value}`, `invalid-${i}`))).ok, false);
    assert.equal(store.read(key).max_batches, 2);
  }
  await app.handle(message('/rounds 7', 'increase'));
  await app.handle(message('start', 'start'));
  await app.handle(message('OFFLINE SAMPLE: I can code.', 'answer'));
  assert.match((await app.handle(message('/rounds 1', 'too-low'))).text, /不能少于 2/);
  assert.equal(store.read(key).max_batches, 7);
  assert.equal((await app.handle(message('/rounds 2', 'lower'))).ok, true);
  await app.handle(message('OFFLINE SAMPLE: I prefer text.', 'final'));
  assert.equal(store.read(key).phase, 'review');
  assert.equal((await app.handle(message('/rounds 3', 'closed'))).ok, false);
  const s = store.read(key);
  await app.handle(message(`/approve ${s.revision} ${s.approval_token}`, 'approve'));
  assert.equal((await app.handle(message('/rounds 3', 'approved-closed'))).ok, false);
});

test('legacy session retains five-batch ceiling when restarted with the new default', async () => {
  const { store, runtimeFor } = setup();
  const app = new InterviewSession({ store, runtimeFor });
  const legacy = app.initial(key);
  delete legacy.max_batches;
  store.write(key, legacy);
  assert.match((await app.handle(message('start', 'start'))).text, /1\/5/);
  assert.equal(store.read(key).max_batches, 5);
});

test('one-batch choice reaches review after one answer', async () => {
  const { app, store } = setup();
  await app.handle(message('/rounds 1', 'configure'));
  await app.handle(message('start', 'start'));
  await app.handle(message('OFFLINE SAMPLE: I can code.', 'answer'));
  assert.equal(store.read(key).phase, 'review');
  assert.equal(store.read(key).messages.filter(m => m.role === 'assistant').length, 1);
});

test('legacy migration preserves explicit operator override and outstanding questions', async () => {
  for (const [override, answered, phase, expected] of [[1, 0, 'new', 1], [7, 0, 'new', 7], [undefined, 5, 'answering', 6], [1, 5, 'answering', 6]]) {
    const { store, runtimeFor } = setup();
    const app = new InterviewSession({ store, runtimeFor, maxBatches: override });
    const legacy = app.initial(key);
    delete legacy.max_batches;
    legacy.answered_batches = answered;
    legacy.phase = phase;
    store.write(key, legacy);
    await app.handle(message('/rounds', 'show'));
    assert.equal(store.read(key).max_batches, expected);
  }
});

test('exhausted budget explains the limit while profile commands remain available', async () => {
  const { store } = setup();
  const app = new InterviewSession({ store, runtimeFor: () => {
    throw Object.assign(new Error('not public'), { code: 'MODEL_BUDGET_EXHAUSTED' });
  } });
  const result = await app.handle(message('start', 'budget1'));
  assert.equal(result.ok, false); assert.match(result.text, /测试模型额度已用完/);
  assert.equal((await app.handle(message('/profile', 'budget2'))).ok, true);
  assert.equal(store.read(key).version, 0);
});

test('standalone interview persists detailed profiles, reviews and exports an approved brief without private references', async () => {
  const { app, store } = setup();
  assert.equal((await app.handle(message('start', '1'))).ok, true);
  assert.equal(store.read(key).version, 0);
  await app.handle(message('OFFLINE SAMPLE: I can build frontend interfaces.', '2'));
  assert.equal(store.read(key).version, 1); assert.equal(store.read(key).approved, null);
  const end = await app.handle(message('OFFLINE SAMPLE: I want to preserve human decision making.', '3'));
  assert.match(end.text, /尚未批准/); assert.equal(store.read(key).phase, 'review');
  assert.match((await app.handle(message('/export', '4'))).text, /尚未批准/);
  const s = store.read(key);
  const approved = await app.handle(message(`/approve ${s.revision} ${s.approval_token}`, '5'));
  assert.equal(approved.ok, true); assert.equal(store.read(key).phase, 'approved');
  assert.match(approved.text, /preference_summary/); assert.doesNotMatch(approved.text, /private_message_ids|item_key/);
  assert.equal(store.read(key).approved.items.length, 2);
});

test('duplicate transport messages and restarts do not repeat model work or increment rounds', async () => {
  const { app, store, runtimeFor } = setup();
  const request = message('start', '1');
  const first = await app.handle(request);
  const restarted = new InterviewSession({ store, runtimeFor, maxBatches: 2 });
  assert.deepEqual(await restarted.handle(request), first);
  assert.equal(store.read(key).messages.length, 1);
  assert.equal((await restarted.handle(message('different content', '1'))).ok, false);
});

test('sender and envelope session both isolate persistent private profiles', async () => {
  const { app } = setup();
  await app.handle(message('PRIVATE_A', '1'));
  for (const overrides of [{ sender: 'sender-b' }, { session_id: 'session-b' }]) {
    const r = await app.handle(message('/profile', '2', overrides));
    assert.doesNotMatch(r.text, /PRIVATE_A/); assert.match(r.text, /v0/);
  }
});

test('human edits revoke old exports and require a fresh approval token', async () => {
  const { app, store } = setup();
  await app.handle(message('start', '1')); await app.handle(message('OFFLINE SAMPLE: I dislike voice.', '2'));
  await app.handle(message('/finish', '3')); const old = store.read(key);
  await app.handle(message(`/approve ${old.revision} ${old.approval_token}`, '4'));
  await app.handle(message('/edit 1 OFFLINE SAMPLE: I prefer text for the demo.', '5'));
  assert.equal(store.read(key).approved, null);
  assert.match((await app.handle(message('/export', '6'))).text, /尚未批准/);
  assert.equal((await app.handle(message(`/approve ${old.revision} ${old.approval_token}`, '7'))).ok, false);
});

test('brief never truncates a hard condition or drops it silently to satisfy the size budget', () => {
  const p = { profile_id: 'p', version: 1, unknowns: [], items: Array.from({ length: 9 }, (_, i) => ({
    item_id: `c${i}`, category: 'constraint', text: 'A condition' })) };
  assert.equal(buildBrief(p).status, 'needs_review'); assert.equal(buildBrief(p).blocking_item_ids.length, 1);
  p.items = [{ item_id: 'long', category: 'participation_condition', text: '字'.repeat(81) }];
  assert.equal(buildBrief(p).status, 'needs_review');
  p.items[0].brief_text = '本人确认的短句';
  assert.equal(buildBrief(p).status, 'ready'); assert.deepEqual(buildBrief(p).items[0].source_item_ids, ['long']);
});

test('failure reserves the message but does not publish partial model output or retry on redelivery', async () => {
  const { store } = setup(); let calls = 0;
  const app = new InterviewSession({ store, runtimeFor: () => ({}), runner: async () => { calls++; throw new Error('PRIVATE_PROVIDER_ERROR'); } });
  const req = message('start', 'failure'); const result = await app.handle(req);
  assert.equal(result.ok, false); assert.doesNotMatch(result.text, /PRIVATE_PROVIDER_ERROR/);
  assert.deepEqual(await app.handle(req), result); assert.equal(calls, 1);
  assert.equal(store.read(key).version, 0); assert.equal(store.read(key).approved, null);
});
