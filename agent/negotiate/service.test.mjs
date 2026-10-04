import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runNegotiator, outputIssues } from './service.mjs';
import { createOfflineRuntime } from '../pi-base/offline.mjs';
import { createDeepSeekRuntime } from '../idea/runtime.mjs';
import { liveRuntime } from '../pi-base/integration-runtime.mjs';
import { openaiResponse } from '../pi-base/test-fixtures/openai.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`../interfaces/fixtures/negotiate-${name}.json`, import.meta.url), 'utf8'));
const pair = fixture('difference'), clarification = fixture('clarification');
const result = (data = pair.response.data) => ({ status: 'ok', data: structuredClone(data), warnings: [] });
const request = () => structuredClone(pair.request);
const run = (responder, options = {}) => runNegotiator({ request: request(), runtime: createOfflineRuntime(responder), ...options });

test('OpenAI Negotiator uses the room model and key, and repairs unsupported citations', async () => {
  const observed = [];
  const runtime = liveRuntime({ env: { PI_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-4.1-mini',
    OPENAI_API_KEY: 'sk-room-negotiator-test', DEEPSEEK_API_KEY: 'unused-shared-key' }, maxModelRequests: 2,
    fetch: async (url, init) => {
      observed.push({ url: String(url), key: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body) });
      const output = result();
      if (observed.length === 1) output.data.difference.source_ids = ['invented-source'];
      return openaiResponse(JSON.stringify(output));
    } });
  const response = await runNegotiator({ request: request(), runtime });
  assert.equal(response.status, 'ok');
  assert.deepEqual(response.data, pair.response.data);
  assert.equal(runtime.requestCount, 2);
  for (const call of observed) {
    assert.equal(call.url, 'https://api.openai.com/v1/responses');
    assert.equal(call.key, 'Bearer sk-room-negotiator-test');
    assert.equal(call.body.model, 'gpt-4.1-mini');
    assert.equal(call.body.store, false);
    assert.deepEqual(call.body.text.format, { type: 'json_object' });
    assert.doesNotMatch(JSON.stringify(call.body), /sk-room-negotiator-test|unused-shared-key/);
  }
  assert.match(JSON.stringify(observed[1].body), /UNKNOWN_SOURCE/);
  assert.ok(response.warnings.some(w => w.startsWith('MODEL_OUTPUT_REPAIRED')));
});

test('the Pi loop returns the model topic, preserving the workflow envelope and authorized inputs', async () => {
  const model = result(); model.data.difference.question = 'Which execution boundary should we adopt?';
  let calls = 0, observed;
  const response = await run((payload, context) => {
    calls++;
    observed = { payload, context };
    return model;
  });
  assert.equal(response.status, 'ok');
  assert.deepEqual(observed.payload, pair.request.payload);
  assert.match(JSON.stringify(observed.context), /rather than lexical similarity/);
  assert.equal(response.data.difference.question, model.data.difference.question);
  assert.equal(response.request_id, pair.request.request_id);
  assert.equal(calls, 1);
});

test('unknown sources get one bounded model correction with machine-readable feedback', async () => {
  let calls = 0;
  const response = await run((payload) => {
    calls++;
    if (calls === 1) { const bad = result(); bad.data.difference.source_ids = ['invented']; return bad; }
    assert.deepEqual(payload.harness_output_correction.issues,
      [{ code: 'UNKNOWN_SOURCE', path: '/data/difference/source_ids' }]);
    return result();
  });
  assert.equal(response.status, 'ok');
  assert.equal(calls, 2);
  assert.ok(response.warnings.some(w => w.startsWith('MODEL_OUTPUT_REPAIRED')));
});

for (const [label, mutate] of [
  ['invented member', r => { r.data.difference.affected_member_ids = ['outsider']; }],
  ['invented source', r => { r.data.difference.source_ids = ['invented']; }],
  ['human approval', r => { r.data.difference.converge = true; }],
  ['wrong status', r => { r.status = 'partial'; }],
  ['single-person team split', r => { r.data.difference.affected_member_ids = ['member-a']; r.data.difference.source_ids = ['profile-1-v1-item-1']; }],
  ['duplicate options', r => { r.data.difference.options[1].key = r.data.difference.options[0].key; }],
]) {
  test(`rejects ${label} after two model attempts, without a rule-based fallback`, async () => {
    let calls = 0;
    const response = await run(() => { calls++; const bad = result(); mutate(bad); return bad; });
    assert.equal(calls, 2);
    assert.equal(response.status, 'error');
    assert.equal(response.error.code, 'INVALID_OUTPUT');
    assert.deepEqual(response.data, {});
  });
}

test('a personal clarification keeps exactly the respondent and their cited source', async () => {
  const data = structuredClone(clarification.response.data);
  Object.assign(data.difference, { affected_member_ids: ['member-a'], source_ids: ['profile-1-v1-item-1'],
    question: 'Which statement reflects your current position?' });
  const response = await run(() => result(data));
  assert.equal(response.status, 'ok');
  assert.deepEqual(response.data.difference.affected_member_ids, ['member-a']);
  assert.equal(response.data.difference.kind, 'clarification');
});

test('agent inferences alone cannot substantiate a team difference', () => {
  const p = request().payload;
  for (const profile of p.shared_context.profiles) for (const item of profile.items) item.basis = 'agent_inference';
  assert.equal(outputIssues(pair.response.data, p)[0].code, 'TWO_MEMBER_EVIDENCE_REQUIRED');
});

test('rejects private/extra payload fields and invalid source ownership before a model call', async () => {
  for (const mutate of [
    p => { p.private_interview = { messages: ['must-not-leave'] }; },
    p => { p.shared_context.sources[0].member_id = 'member-b'; },
    p => { p.shared_context.profiles[0].items[0].source_id = 'missing'; },
  ]) {
    let calls = 0; const req = request(); mutate(req.payload);
    const response = await run(() => { calls++; return result(); }, { request: req });
    assert.equal(response.error.code, 'INVALID_INPUT');
    assert.equal(calls, 0);
  }
});

test('runtime errors do not leak credentials or silently fall back', async () => {
  const response = await run(() => { throw new Error('PRIVATE-TEXT secret-api-key'); });
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'MODEL_ERROR');
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE-TEXT|secret-api-key/);
});

test('a single deadline bounds the model operation', async () => {
  const response = await run(async () => { await new Promise(resolve => setTimeout(resolve, 80)); return result(); }, { timeoutMs: 15 });
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'MODEL_TIMEOUT');
});

test('concurrent rooms receive only their own authorized payload', async () => {
  const seen = [];
  const requests = [request(), request()];
  requests.forEach((req, i) => { req.room_id = `room-${i}`; req.request_id = `request-${i}`;
    req.payload.room_context.hackathon_context = `ONLY-ROOM-${i}`; });
  const responses = await Promise.all(requests.map((req, i) => runNegotiator({ request: req,
    runtime: createOfflineRuntime(async (payload, context) => {
      seen[i] = JSON.stringify(context);
      assert.equal(payload.room_context.hackathon_context, `ONLY-ROOM-${i}`);
      await new Promise(resolve => setTimeout(resolve, 5));
      return result();
    }),
  })));
  responses.forEach((response, i) => {
    assert.equal(response.status, 'ok'); assert.equal(response.room_id, `room-${i}`);
    assert.doesNotMatch(seen[i], new RegExp(`ONLY-ROOM-${1-i}`));
  });
});

test('actual DeepSeek/Pi transport uses this room key, JSON mode and model output', async () => {
  let calls = 0, observed;
  const runtime = createDeepSeekRuntime({ env: { DEEPSEEK_API_KEY: 'room-specific-test-key', DEEPSEEK_MODEL: 'deepseek-flash' },
    maxModelRequests: 2, fetch: async (url, init) => {
      calls++;
      observed = { url: String(url), key: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body) };
      const chunks = [
        { id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(result()) }, finish_reason: null }] },
        { id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ];
      return new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    } });
  const response = await runNegotiator({ request: request(), runtime });
  assert.equal(response.status, 'ok'); assert.equal(calls, 1);
  assert.equal(observed.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(observed.key, 'Bearer room-specific-test-key');
  assert.deepEqual(observed.body.response_format, { type: 'json_object' });
  assert.equal(observed.body.model, 'deepseek-flash');
  const content = observed.body.messages.at(-1).content;
  assert.equal(typeof content === 'string' ? content : content.map(b => b.text).join(''), JSON.stringify(pair.request.payload));
});
