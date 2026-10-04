import test from 'node:test';
import assert from 'node:assert/strict';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { runEvaluator, evaluateIdea } from '../runner.mjs';
import { request, draft, investigation, retrieval, source, idea } from './fixtures.mjs';
import { createModelRuntime } from '../models.mjs';
import { openaiResponse } from '../../pi-base/test-fixtures/openai.mjs';
function fixture(responses) {
  const p = fauxProvider(); const models = createModels(); models.setProvider(p.provider); p.setResponses(responses);
  return { model: p.getModel(), streamFn: models.streamSimple.bind(models) };
}
const final = data => fauxAssistantMessage(JSON.stringify({ status: 'ok', data, warnings: [] }));
const submit = data => fauxAssistantMessage(fauxToolCall('submit_report', { data, warnings: [] }), { stopReason: 'toolUse' });
const researchOnly = (investigate = false) => [
  fauxAssistantMessage(fauxToolCall('search', { query: investigate ? 'realtime subscription documentation' : 'team planning realtime projects' }), { stopReason: 'toolUse' }),
  ...(investigate ? [] : [fauxAssistantMessage(fauxToolCall('search', { query: 'team planning hackathon projects' }), { stopReason: 'toolUse' })]),
  fauxAssistantMessage(fauxToolCall('read_source', { url: source.url }), { stopReason: 'toolUse' }),
];
const research = data => [...researchOnly(Boolean(data.issue_id)), final(data)];
const run = (req, messages, options = {}) => runEvaluator({ request: req, retrieval,
  officialDomains: ['docs.example.com'], ...fixture(messages), ...options });

test('OpenAI evaluator requires research and completes through actual evidence tools and report submission', async () => {
  const calls = [];
  const steps = [
    { name: 'search', arguments: { query: 'team planning realtime projects' } },
    { name: 'search', arguments: { query: 'team planning hackathon projects' } },
    { name: 'read_source', arguments: { url: source.url } },
    { name: 'submit_report', arguments: { data: draft(), warnings: [] } },
  ];
  const runtime = createModelRuntime({ EVALUATOR_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-4.1-mini',
    OPENAI_API_KEY: 'sk-offline-evaluator' }, { fetch: async (_url, init) => {
    calls.push(JSON.parse(init.body));
    assert.ok(calls.length <= steps.length, 'submission needs no extra model call');
    return openaiResponse('', { ...steps[calls.length - 1], id: String(calls.length) });
  } });
  const result = await runEvaluator({ request: request(), retrieval, officialDomains: ['docs.example.com'], ...runtime });
  assert.equal(result.status, 'ok');
  assert.equal(result.data.passed, true);
  assert.equal(result.data.search_log.length, 2);
  assert.equal(result.data.evidence.find(e => e.evidence_id === 'web-1').url, source.url);
  assert.deepEqual(calls[0].tool_choice, { type: 'function', name: 'search' });
  assert.ok(calls.slice(1).every(call => call.tool_choice === 'required'));
});

test('evaluate executes real Pi tools and returns server-generated verdict and source records', async () => {
  const result = await run(request(), research(draft()));
  assert.equal(result.status, 'ok'); assert.equal(result.data.passed, true);
  assert.equal(result.data.candidate_id, 'idea-1'); assert.equal(result.request_id, 'req-1');
  assert.equal(result.data.evidence.find(e => e.evidence_id === 'web-1').url, source.url);
  assert.equal(result.data.search_log.length, 2); assert.ok(result.data.report_id);
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

test('investigation correction explicitly repairs a missing envelope warnings array', async () => {
  const data = investigation();
  const messages = research(data);
  messages[messages.length - 1] = fauxAssistantMessage(JSON.stringify({ status: 'ok', data }));
  messages.push(context => {
    assert.ok(context.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('warnings')));
    return final(data);
  });
  const out = await run(request('evaluator.investigate'), messages);
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.warnings, []);
});

test('repair feedback identifies unsupported check fields instead of asking the model to guess', async () => {
  const invalid = draft(); invalid.technical_checks[0].next_check_type = 'needs_test';
  const messages = research(invalid);
  messages.push(context => {
    assert.ok(context.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('next_check_type')));
    return final(draft());
  });
  assert.equal((await run(request(), messages)).status, 'ok');
});

test('malformed check types still return INVALID_OUTPUT rather than throwing in the correction callback', async () => {
  const invalid = draft(); invalid.technical_checks[0].conclusion = 42;
  const out = await run(request(), [...research(invalid), final(invalid)]);
  assert.equal(out.error.code, 'INVALID_OUTPUT');
});
test('rejects invented evidence and a passing output without actual research', async () => {
  const d = draft(); d.tests.novelty.evidence_ids = ['fiction'];
  assert.equal((await run(request(), [...research(d), final(d)])).error.code, 'INVALID_OUTPUT');
  assert.equal((await run(request(), [final(draft()), final(draft())])).error.code, 'INVALID_OUTPUT');
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
  assert.equal((await run(old, [final(draft()), final(draft())])).error.code, 'INVALID_OUTPUT');
});
test('standalone idea interface returns the same envelope as workflow calls', async () => {
  const r = request(); const out = await evaluateIdea({ idea, context: r.payload, request_id: 'req-standalone',
    room_id: r.room_id, retrieval, officialDomains: ['docs.example.com'], ...fixture(research(draft())) });
  assert.equal(out.request_id, 'req-standalone'); assert.equal(out.data.passed, true);
});
test('invalid feasibility gets one corrective turn without accepting an unknown necessary dependency as pass', async () => {
  const invalid = draft(); invalid.technical_checks.push({ dependency_id: 'new-essential-path', finding: 'Not checked',
    conclusion: 'unknown', evidence_ids: [], next_check: 'Read its documentation' });
  const corrected = structuredClone(invalid); corrected.tests.feasibility.result = 'insufficient_evidence';
  corrected.tests.feasibility.missing_information = ['Verify new-essential-path'];
  const out = await run(request(), [...research(invalid), context => {
    assert.ok(context.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('new-essential-path')));
    return final(corrected);
  }]);
  assert.equal(out.status, 'ok'); assert.equal(out.data.passed, false);
  assert.equal(out.data.tests.feasibility.result, 'insufficient_evidence');
});
test('correction is bounded to one turn and cannot grant invented sources on a second invalid output', async () => {
  const invalid = draft(); invalid.tests.novelty.evidence_ids = ['invented']; let calls = 0;
  const f = fixture([...research(invalid), final(invalid), final(draft())]);
  const out = await runEvaluator({ request: request(), retrieval, officialDomains: ['docs.example.com'],
    model: f.model, streamFn: (...args) => { calls++; return f.streamFn(...args); } });
  assert.equal(out.error.code, 'INVALID_OUTPUT'); assert.equal(calls, 5);
});

test('DeepSeek requires initial research only when the request has a usable tool budget', async () => {
  for (const enabled of [true, false]) {
    const req = request('evaluator.investigate');
    if (!enabled) Object.assign(req.payload.tool_budget, { max_searches: 0, max_reads: 0 });
    const data = investigation();
    if (!enabled) Object.assign(data, { conclusion: 'unknown', evidence_ids: [] });
    const f = fixture(enabled ? research(data) : [final(data)]), choices = [];
    const out = await runEvaluator({ request: req, retrieval, officialDomains: ['docs.example.com'],
      model: { ...f.model, provider: 'deepseek' }, streamFn: (_model, context, options) => {
        choices.push(options?.toolChoice);
        return f.streamFn(f.model, context, options);
      } });
    assert.equal(out.status, 'ok');
    assert.deepEqual(choices[0], enabled ? { type: 'function', function: { name: 'search' } } : 'required');
    assert.ok(choices.slice(1).every(v => v === 'required'));
  }
});

test('typed report submission finishes after tools without generating free-form final JSON', async () => {
  const out = await run(request(), [...researchOnly(), submit(draft())]);
  assert.equal(out.status, 'ok'); assert.equal(out.data.passed, true);
  assert.equal(out.data.candidate_id, 'idea-1'); assert.equal(out.data.evidence.length, 2);
});

test('investigation submission maps capability availability independently of its official source basis', async () => {
  for (const [capability_outcome, outcome] of [['available', 'support'], ['blocked', 'blocker']]) {
    const { conclusion: _legacy, ...data } = investigation();
    Object.assign(data, { capability_outcome, evidence_basis: 'official_documentation' });
    const out = await run(request('evaluator.investigate'), [...researchOnly(true), submit(data)]);
    assert.equal(out.status, 'ok'); assert.equal(out.data.outcome, outcome);
    assert.equal(out.data.conclusion, 'supported_by_source');
  }
});

test('typed submission retains source validation and allows one corrected submission', async () => {
  const invalid = draft(); invalid.tests.novelty.evidence_ids = ['invented'];
  const out = await run(request(), [...researchOnly(), submit(invalid), submit(draft())]);
  assert.equal(out.status, 'ok'); assert.equal(out.data.passed, true);
  assert.ok(!out.data.evidence.some(e => e.evidence_id === 'invented'));
});

test('submission preflight gives precise feedback for missing nested verdicts before SDK validation', async () => {
  const invalid = draft(); delete invalid.tests.novelty.result;
  const messages = [...researchOnly(), submit(invalid), context => {
    const errors = context.messages.filter(m => m.role === 'toolResult' && m.toolName === 'submit_report');
    assert.ok(errors.some(m => m.isError && JSON.stringify(m.content).includes('tests.novelty.result') &&
      JSON.stringify(m.content).includes('Allowed evidence records')));
    return submit(draft());
  }];
  assert.equal((await run(request(), messages)).status, 'ok');
});

test('two schema-invalid submissions terminate without accepting a third or another model call', async () => {
  const invalid = draft(); invalid.technical_checks[0].extra_private_field = 'wrong';
  const f = fixture([...researchOnly(), submit(invalid), submit(invalid), submit(draft())]);
  let calls = 0;
  const out = await runEvaluator({ request: request(), retrieval, officialDomains: ['docs.example.com'], model: f.model,
    streamFn: (...args) => { calls++; return f.streamFn(...args); } });
  assert.equal(out.error.code, 'INVALID_OUTPUT'); assert.equal(calls, 5);
});

test('typed and textual submissions share the single correction allowance', async () => {
  const invalid = draft(); invalid.tests.novelty.evidence_ids = ['invented'];
  const f = fixture([...researchOnly(), submit(invalid), final(invalid), submit(draft())]);
  let calls = 0;
  const out = await runEvaluator({ request: request(), retrieval, officialDomains: ['docs.example.com'], model: f.model,
    streamFn: (...args) => { calls++; return f.streamFn(...args); } });
  assert.equal(out.error.code, 'INVALID_OUTPUT'); assert.equal(calls, 5);
});

test('accepted submission cannot be overwritten by a later call in the same batch', async () => {
  const altered = draft(); altered.tests.novelty.result = 'fail';
  const messages = [...researchOnly(), fauxAssistantMessage([
    fauxToolCall('submit_report', { data: draft(), warnings: [] }, { id: 'submit-first' }),
    fauxToolCall('submit_report', { data: altered, warnings: [] }, { id: 'submit-second' }),
  ], { stopReason: 'toolUse' })];
  const out = await run(request(), messages);
  assert.equal(out.status, 'ok'); assert.equal(out.data.tests.novelty.result, 'pass');
});

test('a valid submission on the last allowed turn completes without an extra model request', async () => {
  const out = await run(request(), [...researchOnly(), submit(draft())], { maxTurns: 4 });
  assert.equal(out.status, 'ok'); assert.equal(out.data.passed, true);
});

test('exhausted call budget prevents report submission and cannot publish a pass', async () => {
  const out = await run(request(), [...researchOnly(), submit(draft())], { maxToolCalls: 3 });
  assert.equal(out.status, 'partial'); assert.equal(out.data.passed, false);
});

test('truncated tool arguments are never executed or accepted as a complete report', async () => {
  const truncated = fauxAssistantMessage(fauxToolCall('submit_report', { data: draft(), warnings: [] }), { stopReason: 'length' });
  const out = await run(request(), [...researchOnly(), truncated]);
  assert.equal(out.status, 'error'); assert.equal(out.error.code, 'MODEL_ERROR');
});

test('a rejected textual output can use its one correction to submit through the typed tool', async () => {
  const out = await run(request(), [...researchOnly(), fauxAssistantMessage('not JSON'), submit(draft())]);
  assert.equal(out.status, 'ok'); assert.equal(out.data.passed, true);
});


test('submission feedback identifies misplaced root fields inside tests and recovers once', async () => {
  const invalid = draft();
  for (const field of ['technical_checks','risks','unverified_assumptions']) {
    invalid.tests[field] = invalid[field]; delete invalid[field];
  }
  const messages = [...researchOnly(), submit(invalid), context => {
    const feedback = context.messages.filter(m => m.role === 'toolResult' && m.toolName === 'submit_report').map(m => JSON.stringify(m.content)).join(' ');
    assert.ok(feedback.includes('data.tests.technical_checks'));
    assert.ok(feedback.includes('data.technical_checks'));
    assert.ok(feedback.includes('data.tests.risks'));
    assert.ok(feedback.includes('preserving its content'));
    return submit(draft());
  }];
  assert.equal((await run(request(),messages)).status,'ok');
  assert.equal((await run(request(),[...researchOnly(),submit(invalid),submit(invalid)])).error.code,'INVALID_OUTPUT');
});

test('revision output instructions use the current candidate version', async () => {
  const req = request(); req.payload.candidate.version = 2;
  const valid = draft(); valid.candidate_version = 2;
  const { createDefinition } = await import('../definition.mjs');
  const definition = createDefinition(req, { snapshot: () => ({evidence:[]}), tools:[] });
  assert.match(definition.operations['evaluator.evaluate'].outputInstructions, /"candidate_version"\s*:\s*2/);
  const messages = [...researchOnly(), submit(valid)];
  const out = await run(req,messages);
  assert.equal(out.status,'ok',JSON.stringify(out));
  assert.equal(out.data.candidate_version,2);
});
