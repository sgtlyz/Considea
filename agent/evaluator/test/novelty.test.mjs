import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../session.mjs';
import { validateDraft, finalizeReport, normalizeRequest } from '../contracts.mjs';
import { createTavilyApi, createTavilyCli } from '../retrieval.mjs';
import { request, draft, source } from './fixtures.mjs';
import { fileURLToPath } from 'node:url';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { runEvaluator } from '../runner.mjs';

const scopedLog = (scope, result_status = 'no_results') => ({ query: `planner site:${scope}.com`, scope,
  executed: true, result_status, result_count: 0, excluded_count: 0, result_urls: [] });
const ledger = search_log => ({ evidence: [source], search_log, incomplete: false });

test('evaluation reserves separate GitHub and Devpost searches even when the model requests general web', async () => {
  const calls = [], s = createSession(request().payload, { retrieval: {
    search: async (query, options) => { calls.push({ query, domains: options.includeDomains }); return { results: [] }; },
    read: async () => { throw Error('unused'); },
  } });
  await s.search('planner site:example.com OR site:devpost.com', 5, undefined, 'web');
  await s.search('planner', 5, undefined, 'github');
  assert.deepEqual(calls.map(v => v.domains), [['github.com'], ['devpost.com']]);
  assert.match(calls[0].query, /site:github\.com/);
  assert.ok(!calls[0].query.includes('site:example.com'));
  assert.match(calls[1].query, /site:devpost\.com\/software/);
  assert.deepEqual(s.snapshot().search_log.map(v => [v.scope, v.executed, v.result_status]),
    [['github', true, 'no_results'], ['devpost', true, 'no_results']]);
});

test('one generic, GitHub-only or combined query cannot establish minimum novelty coverage', () => {
  const d = draft(); d.competitors = []; d.tests.novelty.evidence_ids = [];
  for (const log of [[{ query: 'planner', result_status: 'no_results' }], [scopedLog('github')],
    [{ query: 'site:github.com OR site:devpost.com planner', result_status: 'no_results' }]])
    assert.equal(validateDraft(d, request().payload, ledger(log)), false);
  assert.equal(validateDraft(d, request().payload, ledger([scopedLog('github'), scopedLog('devpost')])), true);
});

test('off-domain and platform directory results are not successful empty project searches', async () => {
  const excluded = ['https://github.com.evil.example/owner/repo', 'https://github.com/topics/planner',
    'https://github.com/some-person', 'https://example.com/github.com/owner/repo',
    'https://github.com/solutions/use-case/devops', 'https://github.com/readme/guides',
    'https://github.com/customer-stories/team', 'https://github.com/resources/articles',
    'https://github.com/solutions%2Fuse-case/devops', 'https://github.com:8443/owner/repo'];
  for (const url of excluded) {
    const s = createSession(request().payload, { retrieval: { search: async () => ({ results: [{ url, title: 'Lead', content: 'Lead' }] }), read: async () => {} } });
    assert.equal((await s.search('planner')).code, 'SOURCE_SCOPE_MISMATCH');
    assert.equal(s.snapshot().search_log[0].result_status, 'failed');
    assert.equal(s.snapshot().search_log[0].excluded_count, 1);
  }
  const s = createSession(request().payload, { retrieval: { search: async () => ({ results: [
    { url: 'https://devpost.com/software/search', title: 'Directory', content: 'Lead' },
    { url: 'https://planner.devpost.com/project-gallery', title: 'Gallery', content: 'Lead' },
  ] }), read: async () => {} } });
  assert.equal((await s.search('planner', 5, undefined, 'devpost')).code, 'SOURCE_SCOPE_MISMATCH');
});

test('eligible project URLs survive filtering and actual returned links are logged', async () => {
  const valid = 'https://github.com/team/planner', s = createSession(request().payload, { retrieval: {
    search: async () => ({ results: [{ url: valid, title: 'Planner', content: 'Project' },
      { url: 'https://github.com/topics/planner', title: 'Directory', content: 'Lead' }] }),
    read: async url => ({ url, content: 'Actual project body' }),
  } });
  const result = await s.search('planner');
  assert.deepEqual(result.results.map(v => v.url), [valid]);
  assert.deepEqual(s.snapshot().search_log[0].result_urls, [valid]);
  assert.equal(s.snapshot().search_log[0].excluded_count, 1);
  assert.equal((await s.read(valid)).ok, true);
  assert.equal((await s.read('https://github.com/topics/planner')).code, 'INVALID_SOURCE');
});

test('budget zero or one makes coverage partial without extra provider calls', async () => {
  for (const max_searches of [0, 1]) {
    const p = request().payload; p.tool_budget.max_searches = max_searches;
    let calls = 0;
    const s = createSession(p, { retrieval: { search: async () => { calls++; return { results: [] }; }, read: async () => {} } });
    if (max_searches) await s.search('planner');
    const out = finalizeReport(draft(), p, s.snapshot());
    assert.equal(calls, max_searches); assert.equal(out.status, 'partial');
    assert.equal(out.tests.novelty.result, 'insufficient_evidence'); assert.equal(out.passed, false);
    assert.equal(out.novelty_coverage.complete, false);
    assert.ok(out.tests.novelty.missing_information.some(v => v.includes('Devpost')));
  }
});

test('failed or unexecuted scope cannot pass, but known duplicate rejection is preserved', () => {
  for (const devpost of [{ ...scopedLog('devpost', 'failed'), error_code: 'TOOL_UNAVAILABLE' },
    { ...scopedLog('devpost', 'failed'), executed: false, error_code: 'BUDGET_EXCEEDED' }]) {
    const l = ledger([scopedLog('github'), devpost]);
    assert.equal(validateDraft(draft(), request().payload, l), false);
    const d = draft(); d.tests.novelty.result = 'fail';
    const out = finalizeReport(d, request().payload, l);
    assert.equal(out.tests.novelty.result, 'fail'); assert.equal(out.status, 'partial');
    assert.equal(out.novelty_coverage.complete, false);
  }
});

test('investigation has no mandatory competitor scopes or domain restriction', async () => {
  const p = request('evaluator.investigate').payload, calls = [];
  const s = createSession(p, { retrieval: { search: async (q, opts) => { calls.push(opts); return { results: [] }; }, read: async () => {} } });
  await s.search('browser microphone permissions');
  assert.equal(calls[0].includeDomains, undefined);
  assert.equal(s.snapshot().search_log[0].scope, 'web');
});

test('scoped report metadata survives previous_report validation but never replaces current searches', () => {
  const report = finalizeReport(draft(), request().payload, ledger([scopedLog('github'), scopedLog('devpost')]));
  const r = request(); r.payload.previous_report = report;
  assert.doesNotThrow(() => normalizeRequest(r));
  assert.equal(validateDraft(draft(), r.payload, ledger([])), false);
  r.payload.previous_report.novelty_coverage.scopes[0].private_messages = ['private'];
  assert.throws(() => normalizeRequest(r), { code: 'INVALID_INPUT' });
});

test('Tavily HTTP forwards domain filters as API parameters', async () => {
  let body;
  const api = createTavilyApi({ apiKey: 'fixture', fetchFn: async (_url, options) => {
    body = JSON.parse(options.body); return Response.json({ results: [] });
  } });
  await api.search('planner', { includeDomains: ['github.com'] });
  assert.deepEqual(body.include_domains, ['github.com']);
});

test('Tavily CLI forwards the include-domains flag through its actual subprocess', async () => {
  const cli = createTavilyCli({ executable: process.execPath,
    argsPrefix: [fileURLToPath(new URL('./scoped-cli-fixture.mjs', import.meta.url))] });
  const result = await cli.search('planner', { includeDomains: ['devpost.com'] });
  assert.equal(result.results[0].content, 'devpost.com');
});

const tool = (name, args) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' });
async function scripted(req, responses, retrieval) {
  const provider = fauxProvider(), models = createModels(); models.setProvider(provider.provider); provider.setResponses(responses);
  return runEvaluator({ request: req, retrieval, officialDomains: ['docs.example.com'],
    model: provider.getModel(), streamFn: models.streamSimple.bind(models) });
}
const emptyRetrieval = { search: async () => ({ results: [] }), read: async url => ({ url, content: source.excerpt }) };

test('Pi submission correction requires the missing platform and completes after its actual search', async () => {
  const d = draft(), out = await scripted(request(), [tool('search', { query: 'planner' }),
    tool('read_source', { url: source.url }), tool('submit_report', { data: d, warnings: [] }), context => {
      assert.ok(context.messages.some(m => m.role === 'toolResult' && m.isError &&
        JSON.stringify(m.content).includes('Devpost')));
      return tool('search', { query: 'planner hackathon', scope: 'devpost' });
    }, tool('submit_report', { data: d, warnings: [] })], emptyRetrieval);
  assert.equal(out.status, 'ok'); assert.equal(out.data.novelty_coverage.complete, true);
  assert.equal(out.data.passed, true);
});

test('Pi returns outer partial for an honest one-search-budget report without extra calls', async () => {
  const req = request(); req.payload.tool_budget.max_searches = 1;
  const d = draft(); d.tests.novelty.result = 'insufficient_evidence'; d.tests.novelty.missing_information = ['Search Devpost'];
  let calls = 0;
  const out = await scripted(req, [tool('search', { query: 'planner' }), tool('read_source', { url: source.url }),
    tool('submit_report', { data: d, warnings: [] })], { ...emptyRetrieval, search: async () => { calls++; return { results: [] }; } });
  assert.equal(calls, 1); assert.equal(out.status, 'partial'); assert.equal(out.data.status, 'partial');
  assert.equal(out.data.tests.feasibility.result, 'pass'); assert.equal(out.data.passed, false);
});

test('concurrent search calls reserve distinct required scopes and aborted calls do not count', async () => {
  const calls = [], s = createSession(request().payload, { retrieval: { ...emptyRetrieval,
    search: async (_q, opts) => { calls.push(opts.includeDomains); return { results: [] }; } } });
  await Promise.all([s.search('planner'), s.search('planner hackathon')]);
  assert.deepEqual(calls, [['github.com'], ['devpost.com']]);
  const p = request().payload; p.tool_budget.max_searches = 3;
  const retry = createSession(p, { retrieval: emptyRetrieval });
  await retry.search('planner', 5, AbortSignal.abort());
  assert.equal(retry.snapshot().search_log[0].executed, false);
  await retry.search('planner'); await retry.search('planner hackathon');
  const out = finalizeReport(draft(), p, retry.snapshot());
  assert.equal(out.novelty_coverage.complete, true); // Only actual retries establish coverage.
  assert.equal(out.status, 'partial'); // Earlier retrieval failures conservatively remain incomplete.
});
