import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchSession, createTavilyProvider, isPublicEvidenceUrl } from './search.mjs';

const timestamp = '2026-10-03T12:00:00.000Z';
const request = (overrides = {}) => ({ payload: {
  search_policy: { enabled: true, max_queries: 3, max_results_per_query: 2, required: false },
  room_context: { member_ids: ['member-alice'] }, provided_evidence: [], ...overrides,
} });
const result = (url = 'https://reddit.com/r/hackathons/comments/example') => ({ url, title: 'An example', content: 'A search snippet' });
const execute = (session, toolName = 'web_search', args = { query: 'campus project ideas' }, signal) =>
  session.tools.find(tool => tool.name === toolName).execute('call-1', args, signal);
const newSession = options => createSearchSession({ request: request(), now: () => timestamp, ...options });
const fetchResponse = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

test('disabled search exposes no tools and preserves independently supplied evidence', () => {
  const provided = { evidence_key: 'external-1', url: 'https://devpost.com/software/demo', title: 'Demo',
    accessed_at: timestamp, source_kind: 'devpost', excerpt: 'Existing authorized evidence', content_level: 'snippet', limitation: 'Snippet only' };
  const input = request({ search_policy: { enabled: false, max_queries: 0, max_results_per_query: 2, required: false }, provided_evidence: [provided] });
  const session = newSession({ request: input });
  assert.deepEqual(session.tools, []);
  assert.deepEqual(session.evidence, [provided]);
  session.evidence[0].title = 'Mutated';
  assert.equal(provided.title, 'Demo');
  assert.deepEqual(session.searchLog, []);
  assert.deepEqual(session.warnings, []);
});

test('all tools share one attempt cap, including failed attempts', async () => {
  let calls = 0;
  const session = newSession({ provider: async () => { calls++; throw new Error('secret key tvly-123'); } });
  assert.equal((await execute(session, 'search_reddit')).details.result_status, 'failed');
  assert.equal((await execute(session, 'search_devpost')).details.result_status, 'failed');
  assert.equal((await execute(session)).details.result_status, 'failed');
  assert.equal((await execute(session)).details.result_status, 'budget_exceeded');
  assert.equal(calls, 3);
  assert.equal(JSON.stringify(session).includes('tvly-123'), false);
  assert.equal(session.warnings.length, 1);
});

test('concurrent tool attempts cannot overspend the shared cap', async () => {
  let calls = 0;
  const session = newSession({ request: request({ search_policy: { enabled: true, max_queries: 1, max_results_per_query: 1, required: false } }),
    provider: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return [result()]; } });
  const responses = await Promise.all([execute(session), execute(session), execute(session)]);
  assert.deepEqual(responses.map(response => response.details.result_status), ['results', 'budget_exceeded', 'budget_exceeded']);
  assert.equal(calls, 1);
});

test('tool inputs admit only query, count rejected attempts, and redact identifiers', async () => {
  let calls = 0;
  const session = newSession({ provider: async () => { calls++; return []; } });
  const invalid = await execute(session, 'search_reddit', { query: 'campus', domains: ['attacker.example'] });
  assert.equal(invalid.details.result_status, 'failed');
  const identity = await execute(session, 'web_search', { query: 'help Member-Alice build a project' });
  assert.equal(identity.details.query, '[redacted query]');
  const email = await execute(session, 'web_search', { query: 'person@university.edu problems' });
  assert.equal(email.details.query, '[redacted query]');
  assert.equal(calls, 0);
  assert.equal((await execute(session)).details.result_status, 'budget_exceeded');
  assert.equal(JSON.stringify(session.searchLog).includes('Member-Alice'), false);
  assert.equal(JSON.stringify(session.searchLog).includes('person@'), false);
});

test('query size and shape are enforced by code even if schema validation is bypassed', async () => {
  for (const args of [{ query: '' }, { query: ' ' }, { query: 'x'.repeat(301) }, { query: 2 }, {}, ['query']]) {
    const session = newSession({ provider: async () => assert.fail('Invalid input reached provider') });
    assert.equal((await execute(session, 'web_search', args)).details.result_status, 'failed');
  }
});

test('exhausted budgets still redact identities and normalize empty or malformed logged queries', async () => {
  for (const maxQueries of [0, 1]) {
    const session = newSession({ request: request({ search_policy: {
      enabled: true, max_queries: maxQueries, max_results_per_query: 1, required: false,
    } }), provider: async () => [] });
    if (maxQueries === 1) await execute(session);
    for (const [args, loggedQuery] of [
      [{ query: '' }, '[invalid query]'], [{ query: ' ' }, '[invalid query]'],
      [{}, '[invalid query]'], [{ query: 'member-alice problems' }, '[redacted query]'],
      [{ query: 'person@university.edu problems' }, '[redacted query]'],
    ]) {
      const response = await execute(session, 'web_search', args);
      assert.equal(response.details.result_status, 'budget_exceeded');
      assert.equal(response.details.query, loggedQuery);
    }
    const log = JSON.stringify(session.searchLog);
    assert.equal(log.includes('member-alice'), false);
    assert.equal(log.includes('person@university.edu'), false);
    assert.equal(session.searchLog.every(entry => entry.query.length > 0), true);
  }
});

test('Reddit and Devpost tools force source domains and reject domain confusion', async () => {
  for (const [toolName, domain] of [['search_reddit', 'reddit.com'], ['search_devpost', 'devpost.com']]) {
    const session = newSession({ provider: async ({ domains, maxResults }) => {
      assert.deepEqual(domains, [domain]);
      assert.equal(maxResults, 2);
      return [result(`https://${domain}.attacker.com/a`), result(`https://attacker${domain}/a`),
        result(`https://${domain}@attacker.com/a`), result(`https://www.${domain}/a`), result(`https://${domain}/b`)];
    } });
    const response = await execute(session, toolName);
    assert.equal(response.details.result_status, 'results');
    assert.deepEqual(session.evidence.map(item => item.url), [`https://www.${domain}/a`, `https://${domain}/b`]);
    assert.equal(session.evidence[0].source_kind, domain === 'reddit.com' ? 'reddit' : 'devpost');
    assert.equal(session.warnings.length, 1);
  }
});

test('general web rejects credentialed, local, numeric, non-HTTPS, and oversized reference links', () => {
  for (const url of ['http://example.com/a', 'file:///etc/passwd', 'https://alice:secret@example.com/a',
    'https://127.0.0.1/a', 'https://2130706433/a', 'https://0x7f000001/a', 'https://10.1.1.1/a',
    'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://localhost/a', 'https://host.local/a',
    'https://office.internal/a', 'https://printer/a', 'https://localhost./a', 'https://a.com/\na',
    `https://example.com/${'a'.repeat(2048)}`]) assert.equal(isPublicEvidenceUrl(url), false, url);
  assert.equal(isPublicEvidenceUrl('https://docs.example.com/reference'), true);
});

test('evidence fields are bounded, keys avoid provided collisions, and results retain snippet limitations', async () => {
  const provided = { evidence_key: 'external-1', url: 'https://example.com/prior', title: 'Prior', accessed_at: timestamp,
    source_kind: 'web', excerpt: 'Prior text', content_level: 'snippet', limitation: 'Not independently verified' };
  const session = newSession({ request: request({ provided_evidence: [provided] }), provider: async () => [
    { ...result('https://example.com/a'), title: 'T'.repeat(300), content: 'C'.repeat(2000) },
    result('https://example.com/a'), result('https://example.com/b'), result('https://example.com/c'),
  ] });
  const response = await execute(session);
  assert.equal(session.evidence.length, 3);
  assert.deepEqual(response.details.evidence_keys, ['external-2', 'external-3']);
  assert.equal(session.evidence[1].title.length, 200);
  assert.equal(session.evidence[1].excerpt.length, 1200);
  assert.equal(session.evidence[1].accessed_at, timestamp);
  assert.equal(session.evidence[1].content_level, 'snippet');
  assert.match(session.evidence[1].limitation, /not fetched/);
  assert.match(response.details.notice, /untrusted/);
  response.details.evidence[0].excerpt = 'Mutated output';
  assert.equal(session.evidence[1].excerpt.length, 1200);
  assert.deepEqual(session.searchLog[0].evidence_keys, ['external-2', 'external-3']);
});

test('unavailable provider and actual zero results have different ledger statuses', async () => {
  const absent = newSession();
  assert.equal(absent.tools.length, 3);
  assert.equal((await execute(absent)).details.result_status, 'failed');
  assert.match(absent.warnings[0], /no search provider/);
  const empty = newSession({ provider: async () => [] });
  assert.equal((await execute(empty)).details.result_status, 'no_results');
  assert.deepEqual(empty.warnings, []);
  const malformed = newSession({ provider: async () => ({ results: [] }) });
  assert.equal((await execute(malformed)).details.result_status, 'failed');
});

test('request and tool cancellation stop waiting without recording late evidence or leaking abort reasons', async () => {
  for (const cancellationKind of ['request', 'tool']) {
    const controller = new AbortController();
    let resolveProvider, started;
    const ready = new Promise(resolve => { started = resolve; });
    const session = newSession({ signal: cancellationKind === 'request' ? controller.signal : undefined,
      provider: async () => { started(); return new Promise(resolve => { resolveProvider = resolve; }); } });
    const pending = execute(session, 'web_search', { query: 'campus tools' }, cancellationKind === 'tool' ? controller.signal : undefined);
    await ready;
    controller.abort(new Error('private abort secret'));
    const response = await pending;
    assert.equal(response.details.result_status, 'failed');
    resolveProvider([result()]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(session.evidence, []);
    assert.equal(JSON.stringify(response).includes('private abort secret'), false);
  }
});

test('pre-aborted requests never invoke the provider', async () => {
  const controller = new AbortController();
  controller.abort();
  const session = newSession({ signal: controller.signal, provider: async () => assert.fail('Should not call') });
  assert.equal((await execute(session)).details.result_status, 'failed');
});

test('Tavily transport pins endpoint, authentication, restrictions, and cost options', async () => {
  let calls = 0;
  const provider = createTavilyProvider({ apiKey: 'tvly-test-key', fetch: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.tavily.com/search');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer tvly-test-key');
    assert.deepEqual(JSON.parse(options.body), { query: 'campus tools', max_results: 2, search_depth: 'basic',
      include_answer: false, include_raw_content: false, include_domains: ['devpost.com'], include_domains_mode: 'restrict' });
    return fetchResponse({ results: [result('https://devpost.com/software/demo')] });
  } });
  assert.equal((await provider({ query: 'campus tools', domains: ['devpost.com'], maxResults: 2 })).length, 1);
  assert.equal(calls, 1);
});

test('Tavily general search omits restricted mode when no domains are supplied', async () => {
  const provider = createTavilyProvider({ apiKey: 'test', fetch: async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).include_domains, []);
    assert.equal(Object.hasOwn(JSON.parse(options.body), 'include_domains_mode'), false);
    return fetchResponse({ results: [] });
  } });
  assert.deepEqual(await provider({ query: 'campus', maxResults: 1 }), []);
});

test('Tavily redacts fetch and HTTP errors, does not retry, and rejects malformed responses', async () => {
  for (const fakeFetch of [
    async () => { throw new Error('tvly-secret / private query'); },
    async () => new Response('tvly-secret', { status: 401 }),
    async () => new Response('tvly-secret', { status: 302, headers: { location: 'https://evil.example' } }),
    async () => new Response('not json'),
    async () => fetchResponse({ results: 'incorrect' }),
  ]) {
    let calls = 0;
    const provider = createTavilyProvider({ apiKey: 'tvly-secret', fetch: async (...args) => { calls++; return fakeFetch(...args); } });
    await assert.rejects(provider({ query: 'campus', maxResults: 1 }), error => !error.message.includes('tvly-secret') && !error.message.includes('private query'));
    assert.equal(calls, 1);
  }
});

test('Tavily rejects response sizes by both declared and actual streamed bytes', async () => {
  for (const response of [new Response('{}', { headers: { 'content-length': String(300_000) } }),
    new Response('x'.repeat(300_000))]) {
    const provider = createTavilyProvider({ apiKey: 'test', fetch: async () => response });
    await assert.rejects(provider({ query: 'campus', maxResults: 1 }), { code: 'INVALID_RESPONSE' });
  }
});

test('Tavily timeout remains bounded even when an injected fetch ignores abort', async () => {
  const provider = createTavilyProvider({ apiKey: 'test', timeoutMs: 5, fetch: async () => new Promise(() => {}) });
  await assert.rejects(provider({ query: 'campus', maxResults: 1 }), { code: 'TIMEOUT' });
});

test('Tavily cancellation never exports custom abort reasons', async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const provider = createTavilyProvider({ apiKey: 'test', fetch: async () => { started(); return new Promise(() => {}); } });
  const pending = provider({ query: 'campus', maxResults: 1, signal: controller.signal });
  await ready;
  controller.abort(new Error('private abort reason'));
  await assert.rejects(pending, error => error.code === 'ABORTED' && !error.message.includes('private'));
});

test('invalid policy and unavailable credentials fail before network use', async () => {
  assert.throws(() => newSession({ request: request({ search_policy: { enabled: true, max_queries: 9, max_results_per_query: 2, required: false } }) }), /Invalid search policy/);
  for (const options of [{}, { apiKey: '' }, { apiKey: ' ' }]) {
    const provider = createTavilyProvider({ ...options, fetch: async () => assert.fail('Must not call') });
    await assert.rejects(provider({ query: 'campus', maxResults: 1 }), { code: 'UNAVAILABLE' });
  }
});
