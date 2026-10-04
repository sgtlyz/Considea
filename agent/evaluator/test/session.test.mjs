import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../session.mjs';
import { request, retrieval, source } from './fixtures.mjs';
const make = (options = {}, p = request().payload) => createSession(p, { retrieval,
  officialDomains: ['docs.example.com'], ...options });

test('search discovers links, read registers actual body, official and member evidence retain provenance', async () => {
  const s = make(); const r = await s.search('文档'); assert.equal(r.ok, true);
  assert.equal(s.snapshot().evidence.length, 1); // Authorized member resource only, search snippet is not evidence.
  const read = await s.read(source.url); assert.equal(read.ok, true); assert.equal(read.evidence.evidence_id, 'web-1');
  assert.equal(read.evidence.source_kind, 'official_documentation');
  assert.equal(s.snapshot().evidence[0].source_ref.profile_id, 'p-a');
  assert.equal(s.snapshot().evidence[1].excerpt, '支持订阅表变更。');
});
test('failed search differs from no results and exhausted budget prevents another external call', async () => {
  const p = request().payload; p.tool_budget.max_searches = 1;
  const s = make({ retrieval: { ...retrieval, search: async () => ({ results: [] }) } }, p);
  assert.equal((await s.search('first')).ok, true);
  assert.equal(s.snapshot().search_log[0].result_status, 'no_results');
  assert.equal((await s.search('second')).code, 'BUDGET_EXCEEDED'); assert.equal(s.snapshot().incomplete, true);
  const f = make({ retrieval: { ...retrieval, search: async () => { throw new Error('secret'); } } });
  assert.equal((await f.search('test')).code, 'TOOL_UNAVAILABLE');
  assert.equal(f.snapshot().search_log[0].result_status, 'failed');
  assert.ok(!JSON.stringify(f.snapshot()).includes('secret'));
});
test('timeout freezes late results and concurrent sessions do not share evidence', async () => {
  const p = request().payload; p.tool_budget.per_call_timeout_ms = 10;
  const slow = make({ retrieval: { ...retrieval, read: async url => {
    await new Promise(r => setTimeout(r, 40)); return { url, content: 'late' }; } } }, p);
  await slow.search('docs'); assert.equal((await slow.read(source.url)).code, 'TOOL_TIMEOUT');
  slow.freeze(); await new Promise(r => setTimeout(r, 50)); assert.equal(slow.snapshot().evidence.length, 1);
  const a = make(), b = make(); await a.search('a'); await a.read(source.url);
  assert.equal(b.snapshot().evidence.length, 1); assert.equal(b.snapshot().search_log.length, 0);
});
test('zero budgets, untrusted direct URLs and cancellation stop research', async () => {
  const p = request().payload; p.tool_budget.max_searches = 0; p.tool_budget.max_reads = 0;
  const s = make({}, p); assert.equal((await s.search('test')).code, 'BUDGET_EXCEEDED');
  assert.equal((await s.read(source.url)).code, 'BUDGET_EXCEEDED');
  const t = make(); assert.equal((await t.read('https://unrelated.example')).code, 'INVALID_SOURCE');
  t.freeze(); assert.equal((await t.search('late')).code, 'CANCELLED');
});
