import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetedFetch } from './budget.mjs';
const url = 'https://api.deepseek.com/v1/chat/completions';
test('approved cumulative 40-call cap preserves ledger and stops at either limit', async () => {
  let ledger = { calls: 39, reserved_micros: 975_000 }, calls = 0;
  const store = { read: () => ledger, write: (_, value) => { ledger = value; } };
  const config = { store, maxCalls: 40, maxUsd: 1, fetch: async () => { calls++; return {}; } };
  await budgetedFetch(config)(url, request());
  await assert.rejects(budgetedFetch(config)(url, request()), /exhausted/);
  assert.deepEqual(ledger, { calls: 40, reserved_micros: 1_000_000 });
  assert.equal(calls, 1);
  assert.throws(() => budgetedFetch({ ...config, maxCalls: 93 }));
  assert.throws(() => budgetedFetch({ ...config, maxUsd: 2.31 }));
});
const request = extra => ({ body: JSON.stringify({ model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: 2048, messages: [{ role: 'user', content: 'JSON test' }], ...extra }) });
function setup() {
  let ledger = null, calls = 0;
  const store = { read: () => ledger, write: (_, value) => { ledger = value; } };
  const config = { store, maxCalls: 4, maxUsd: 0.05, fetch: async () => { calls++; throw new Error('transport uncertain'); } };
  return { config, calls: () => calls, ledger: () => ledger };
}
test('dollar reservations survive restarts and uncertain failures without retries', async () => {
  const s = setup();
  await assert.rejects(budgetedFetch(s.config)(url, request()), /uncertain/);
  await assert.rejects(budgetedFetch(s.config)(url, request()), /uncertain/);
  await assert.rejects(budgetedFetch(s.config)(url, request()), /exhausted/);
  assert.equal(s.calls(), 2); assert.deepEqual(s.ledger(), { calls: 2, reserved_micros: 50_000 });
});
test('model, output, and UTF8 size checks prevent network calls before reserving budget', async () => {
  const s = setup(), run = budgetedFetch(s.config);
  for (const extra of [{ model: 'deepseek-v4-pro' }, { max_tokens: 2049 }, { messages: [{ role: 'user', content: '字'.repeat(17_000) }] }]) {
    await assert.rejects(run(url, request(extra)));
  }
  assert.equal(s.calls(), 0); assert.equal(s.ledger(), null);
});
