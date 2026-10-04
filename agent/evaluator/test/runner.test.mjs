import test from 'node:test';
import assert from 'node:assert/strict';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { runEvaluator, evaluateIdea } from '../runner.mjs';
import { request, draft, investigation, retrieval, source, idea } from './fixtures.mjs';
function fixture(responses) {
  const p = fauxProvider(); const models = createModels(); models.setProvider(p.provider); p.setResponses(responses);
  return { model: p.getModel(), streamFn: models.streamSimple.bind(models) };
}
const final = data => fauxAssistantMessage(JSON.stringify({ status: 'ok', data, warnings: [] }));
const research = data => [fauxAssistantMessage(fauxToolCall('search', { query: '协作 realtime' }), { stopReason: 'toolUse' }),
  fauxAssistantMessage(fauxToolCall('read_source', { url: source.url }), { stopReason: 'toolUse' }), final(data)];
const run = (req, messages, options = {}) => runEvaluator({ request: req, retrieval,
  officialDomains: ['docs.example.com'], ...fixture(messages), ...options });

test('evaluate executes real Pi tools and returns server-generated verdict and source records', async () => {
  const result = await run(request(), research(draft()));
  assert.equal(result.status, 'ok'); assert.equal(result.data.passed, true);
  assert.equal(result.data.candidate_id, 'idea-1'); assert.equal(result.request_id, 'req-1');
  assert.equal(result.data.evidence.find(e => e.evidence_id === 'web-1').url, source.url);
  assert.equal(result.data.search_log.length, 1); assert.ok(result.data.report_id);
});
test('business rejection is an ok response rather than runtime error', async () => {
  const d = draft(); d.tests.novelty.result = 'fail'; d.tests.novelty.reason = '目标用户、问题和核心方案高度相同且无差异。';
  const r = await run(request(), research(d)); assert.equal(r.status, 'ok'); assert.equal(r.data.passed, false);
  assert.equal(r.error, null);
});
test('investigate preserves issue identity and evidence', async () => {
  const r = await run(request('evaluator.investigate'), research(investigation()));
  assert.equal(r.status, 'ok'); assert.equal(r.data.issue_id, 'issue-1'); assert.equal(r.data.evidence.length, 2);
});
test('rejects invented evidence and a passing output without actual research', async () => {
  const d = draft(); d.tests.novelty.evidence_ids = ['fiction'];
  assert.equal((await run(request(), research(d))).error.code, 'INVALID_OUTPUT');
  assert.equal((await run(request(), [final(draft())])).error.code, 'INVALID_OUTPUT');
});
test('failed reads and hard turn budget preserve partial report with unknown tests', async () => {
  const d = draft(); for (const t of Object.values(d.tests)) {
    t.result = 'insufficient_evidence'; t.evidence_ids = []; t.missing_information = ['读取正文']; }
  d.competitors = []; d.technical_checks[0].conclusion = 'unknown'; d.technical_checks[0].evidence_ids = [];
  const r = await run(request(), research(d), { retrieval: { ...retrieval, read: async () => { throw Error('secret'); } } });
  assert.equal(r.status, 'partial'); assert.equal(r.data.passed, false); assert.equal(r.data.evidence.length, 1);
  const hard = await run(request(), research(draft()), { maxTurns: 1 });
  assert.equal(hard.status, 'partial'); assert.equal(hard.data.tests.feasibility.result, 'insufficient_evidence');
  assert.equal(hard.data.search_log.length, 1);
});
test('model deadline returns partial without publishing late claims', async () => {
  const r = request(); r.payload.tool_budget.timeout_ms = 20; r.payload.tool_budget.per_call_timeout_ms = 10;
  const out = await run(r, [() => new Promise(resolve => setTimeout(() => resolve(final(draft())), 60))]);
  assert.equal(out.status, 'partial'); assert.equal(out.data.passed, false);
  assert.equal(out.data.tests.novelty.result, 'insufficient_evidence');
});
test('invalid input or missing runtime configuration is rejected before model execution', async () => {
  const r = request(); r.payload.messages = ['private'];
  assert.equal((await run(r, [final(draft())])).error.code, 'INVALID_INPUT');
  assert.equal((await runEvaluator({ request: request(), retrieval })).error.code, 'CONFIG_ERROR');
});
test('parallel requests bind their own candidate version and never reuse old report sources', async () => {
  const req2 = request(); req2.request_id = 'req-2'; req2.room_id = 'room-2'; req2.payload.room_config.room_id = 'room-2';
  req2.payload.candidate.version = 2; const d2 = draft(); d2.candidate_version = 2;
  const results = await Promise.all([run(request(), research(draft())), run(req2, research(d2))]);
  assert.deepEqual(results.map(r => r.data.candidate_version), [1, 2]);
  assert.notEqual(results[0].data.report_id, results[1].data.report_id);
  const old = request(); old.payload.previous_report = { evidence: [source] };
  assert.equal((await run(old, [final(draft())])).error.code, 'INVALID_OUTPUT');
});
test('standalone idea interface returns the same envelope as workflow calls', async () => {
  const r = request(); const out = await evaluateIdea({ idea, context: r.payload, request_id: 'req-standalone',
    room_id: r.room_id, retrieval, officialDomains: ['docs.example.com'], ...fixture(research(draft())) });
  assert.equal(out.request_id, 'req-standalone'); assert.equal(out.data.passed, true);
});
