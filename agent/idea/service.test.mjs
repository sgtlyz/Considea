import test from 'node:test';
import assert from 'node:assert/strict';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { fixture } from './fixtures.mjs';
import { runIdea, runIdeaFromStore } from './service.mjs';
import { createOfflineRuntime, finalMessage, callTools } from './offline.mjs';
import { runDemo } from './demo.mjs';

test('actual Pi loop completes v2.0 generate and revise without changing workflow headers', async () => {
  for (const operation of ['idea.generate', 'idea.revise']) {
    const f = fixture(operation);
    const result = await runIdea({ request: f.request, runtime: createOfflineRuntime([finalMessage(f.response.data)]) });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, f.response.data);
    for (const key of ['request_id', 'room_id', 'operation', 'input_revision']) assert.equal(result[key], f.request[key]);
    assert.equal('research' in result, false);
  }
});

test('demo invokes real search tools with explicitly fabricated results for generate and revise', async () => {
  for (const revise of [false, true]) {
    const result = await runDemo({ revise });
    assert.equal(result.status, 'ok', JSON.stringify(result));
    assert.equal(result.research.search_log.length, 2);
    assert.deepEqual(result.research.evidence.map(e => e.source_kind), ['reddit', 'devpost']);
    assert.ok(result.research.evidence.every(e => e.title.includes('OFFLINE MOCK')));
  }
});

test('invalid envelope, early convergence and oversized context are rejected before model execution', async () => {
  const f = fixture('idea.generate');
  const runtime = { model: {}, streamFn() { assert.fail('must not call model'); } };
  const invalid = structuredClone(f.request);
  invalid.payload.discussion_round = 3;
  for (const request of [null, { ...f.request, operation: 'negotiate.detect' }, invalid]) {
    assert.equal((await runIdea({ request, runtime })).error.code, 'INVALID_INPUT');
  }
  assert.equal((await runIdea({ request: f.request, runtime, limits: { maxInputBytes: 10 } })).error.code, 'BUDGET_EXCEEDED');
  assert.equal((await runIdea({ request: f.request, runtime, limits: { maxTurns: 0 } })).error.code, 'CONFIG_ERROR');
});

test('research ledger comes from tool execution and fabricated citations are rejected', async () => {
  const f = fixture('idea.generate', { research: true });
  const data = structuredClone(f.response.data);
  data.candidates[0].draft.inspiration_refs = [{ evidence_key: 'invented', borrowed_mechanism: 'mechanism', adaptation: 'adaptation', known_difference: 'unknown' }];
  const result = await runIdea({ request: f.request, runtime: createOfflineRuntime([finalMessage(data)]) });
  assert.equal(result.error.code, 'INVALID_OUTPUT');
  assert.deepEqual(result.data, {});
  assert.deepEqual(result.research.evidence, []);
});

test('search failure is surfaced without inventing no-results; required evidence prevents unsupported publication', async () => {
  for (const required of [false, true]) {
    const f = fixture('idea.generate', { research: true });
    f.request.payload.search_policy.required = required;
    const result = await runIdea({ request: f.request, searchProvider: async () => { throw new Error('secret-token'); },
      runtime: createOfflineRuntime([callTools([['search_reddit', { query: 'team coordination' }]]), finalMessage(f.response.data)]) });
    assert.equal(result.status, required ? 'error' : 'ok');
    assert.equal(result.research.search_log[0].result_status, 'failed');
    assert.ok(!JSON.stringify(result).includes('secret-token'));
    if (required) assert.equal(result.error.code, 'TOOL_UNAVAILABLE');
    else assert.ok(result.warnings.some(w => w.includes('search failed')));
  }
});

test('disabled research never invokes provider, and model status cannot advance workflow', async () => {
  const f = fixture('idea.generate', { research: true });
  f.request.payload.search_policy.enabled = false;
  f.request.payload.search_policy.required = false;
  f.request.payload.search_policy.max_queries = 0;
  const result = await runIdea({ request: f.request, searchProvider: () => assert.fail('disabled'),
    runtime: createOfflineRuntime([fauxAssistantMessage(JSON.stringify({ status: 'partial', data: f.response.data, warnings: [] }))]) });
  assert.equal(result.error.code, 'INVALID_OUTPUT');
  assert.deepEqual(result.research.search_log, []);
});

test('memory outage retains full authorized context and returns a visible warning', async () => {
  const f = fixture('idea.generate');
  const result = await runIdea({ request: f.request, memoryClient: { search: async () => { throw new Error('sensitive'); } },
    runtime: createOfflineRuntime([callTools([['recall_shared_memory', { query: 'past tradeoffs' }]]), context => {
      const user = context.messages.find(m => m.role === 'user');
      assert.ok(JSON.stringify(user).includes(f.request.payload.shared_context.sources[0].source_id));
      return finalMessage(f.response.data);
    }]) });
  assert.equal(result.status, 'ok');
  assert.ok(result.warnings.some(w => w.includes('memory retrieval failed')));
  assert.ok(!JSON.stringify(result).includes('sensitive'));
});

test('public progress does not expose query text, source bodies or model output', async () => {
  const f = fixture('idea.generate');
  const events = [];
  await runIdea({ request: f.request, onProgress: e => events.push(e), runtime: createOfflineRuntime([finalMessage(f.response.data)]) });
  assert.ok(events.length);
  assert.ok(events.every(e => Object.keys(e).sort().join(',') === 'request_id,type'));
});

test('store bridge passes authorization revision to atomic commit and returns saved responses without execution', async () => {
  const f = fixture('idea.generate');
  let commits = 0;
  const store = {
    loadSnapshot: async () => ({ request: f.request, authorization_revision: 99 }),
    commitResult: async ({ request, response, authorizationRevision }) => {
      assert.equal(authorizationRevision, 99); assert.deepEqual(request, f.request); commits++; return response;
    },
  };
  const args = { store, roomId: f.request.room_id, requestId: f.request.request_id, operation: f.request.operation };
  assert.equal((await runIdeaFromStore({ ...args, runtime: createOfflineRuntime([finalMessage(f.response.data)]) })).status, 'ok');
  assert.equal(commits, 1);
  store.loadSnapshot = async () => ({ request: f.request, authorization_revision: 99, response: f.response });
  assert.deepEqual(await runIdeaFromStore(args), f.response);
  assert.equal(commits, 1);
  await assert.rejects(runIdeaFromStore({ ...args, roomId: 'other-room' }), /does not match/);
});

test('store bridge propagates stale commit instead of returning unpublished candidate', async () => {
  const f = fixture('idea.generate');
  await assert.rejects(runIdeaFromStore({ roomId: f.request.room_id, requestId: f.request.request_id,
    operation: f.request.operation, runtime: createOfflineRuntime([finalMessage(f.response.data)]),
    store: { loadSnapshot: async () => ({ request: f.request, authorization_revision: 1 }),
      commitResult: async () => { throw new Error('STALE_INPUT'); } } }), /STALE_INPUT/);
});

test('pre-cancelled runs never execute and cancellation before commit prevents publication', async () => {
  const f = fixture('idea.generate');
  const controller = new AbortController(); controller.abort();
  const result = await runIdea({ request: f.request, signal: controller.signal,
    runtime: { model: {}, streamFn: () => assert.fail('cancelled before model') } });
  assert.equal(result.status, 'error');
  const during = new AbortController();
  await assert.rejects(runIdeaFromStore({ roomId: f.request.room_id, requestId: f.request.request_id,
    operation: f.request.operation, signal: during.signal,
    runtime: createOfflineRuntime([() => { during.abort(); return finalMessage(f.response.data); }]),
    store: { loadSnapshot: async () => ({ request: f.request, authorization_revision: 1 }),
      commitResult: async () => assert.fail('cancelled tasks must not publish') } }), { name: 'AbortError' });
});

test('cached replay is revalidated and malformed final warnings cannot bypass the contract', async () => {
  const f = fixture('idea.generate');
  const result = await runIdea({ request: f.request, runtime: createOfflineRuntime([
    fauxAssistantMessage(JSON.stringify({ status: 'ok', data: f.response.data, warnings: [''] }))]) });
  assert.equal(result.error.code, 'INVALID_OUTPUT');
  const stale = structuredClone(f.response);
  stale.data.candidates[0].draft.discussion_source_ids = ['withdrawn-source'];
  await assert.rejects(runIdeaFromStore({ roomId: f.request.room_id, requestId: f.request.request_id, operation: f.request.operation,
    store: { loadSnapshot: async () => ({ request: f.request, authorization_revision: 1, response: stale }) } }), /protocol validation/);
});
