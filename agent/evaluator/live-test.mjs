import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createModelRuntime } from './models.mjs';
import { createTavilyCli, createTavilyApi } from './retrieval.mjs';
import { runEvaluator } from './runner.mjs';

// Explicit opt-in runner. Never included in `pnpm test`; calls real billable services.
const here = fileURLToPath(new URL('.', import.meta.url));
if (existsSync(resolve(here, '.env'))) process.loadEnvFile(resolve(here, '.env'));
const requested = process.argv.slice(2);
const scenario = requested[0] ?? 'all';
const allowed = ['all', 'services', 'preflight', 'feasible', 'duplicate', 'blocker', 'investigate'];
if (requested.length > 1 || !allowed.includes(scenario)) throw Error(`Usage: node live-test.mjs [${allowed.join('|')}]`);
const secrets = ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY'].map(k => process.env[k]).filter(Boolean);
const safe = value => {
  let content = JSON.stringify(value, null, 2);
  for (const key of secrets) content = content.split(key).join('[REDACTED]');
  return content.replace(/Bearer\s+[^\s"\\]+/g, 'Bearer [REDACTED]');
};
const directory = resolve(here, 'live-results', new Date().toISOString().replace(/[:.]/g, '-') + '-' + scenario);
mkdirSync(directory, { recursive: true });
const save = (name, value) => writeFileSync(resolve(directory, name), safe(value) + '\n');
const runs = [], events = [];
let runtime, retrieval;
const log = event => { const item = { at: new Date().toISOString(), ...event }; events.push(item); console.log(safe(item)); };
const setup = () => {
  runtime ??= createModelRuntime(process.env);
  retrieval ??= process.env.EVALUATOR_RETRIEVAL === 'api' ? createTavilyApi({ apiKey: process.env.TAVILY_API_KEY }) :
    createTavilyCli({ executable: process.env.TVLY_PATH || 'tvly', pythonExecutable: process.env.TVLY_PYTHON });
};
const domains = ['developer.mozilla.org', 'react.dev', 'w3.org', 'w3c.github.io', 'webrtc.org', 'trello.com', 'atlassian.com',
  'api-docs.deepseek.com', 'spacetimedb.com', 'fetch.ai', 'agentverse.ai'];

function request(kind) {
  const base = { schema_version: '1.0', request_id: `live-${kind}`, room_id: 'live-test-room',
    input_revision: 1, operation: kind === 'investigate' ? 'evaluator.investigate' : 'evaluator.evaluate',
    payload: { room_config: { room_id: 'live-test-room', members: ['test-developer'],
      hackathon_context: 'A controlled integration test. This is a sample idea, not the team product.',
      constraints: ['The MVP is a browser application. Do not assume external accounts or hardware are available.'],
      time_limit: { kind: 'none' } },
    shared_resources: [{ profile_id: 'test-profile', profile_version: 1, item_id: 'web-development',
      member_id: 'test-developer', category: 'skill',
      text: 'Test context: one developer with JavaScript, HTML, CSS and browser DOM experience. This is a supplied test premise, not independent verification.' },
      { profile_id: 'test-profile', profile_version: 1, item_id: 'development-machine', member_id: 'test-developer',
        category: 'resource', text: 'A working laptop with current Chrome and Firefox and a local static HTTP server is available. This is a supplied test premise, not independent verification.' }],
    tool_budget: { max_searches: 3, max_reads: 4, timeout_ms: 180000, per_call_timeout_ms: 30000 },
    candidate: { candidate_id: `live-idea-${kind}`, version: 2, title: 'Workshop Decision Receipt',
      target_user: 'Volunteer workshop teams deciding between project directions',
      problem: 'Teams lose the rationale and explicit tradeoffs behind a chosen direction.',
      solution: 'A browser-only offline decision receipt: record alternatives, the selected option, a rejected tradeoff, and an agreed next check. Export a single JSON file that can be reviewed later.',
      mvp: 'One local page to add a decision, edit its tradeoff and next check, persist it locally and export a JSON file. No AI, backend, accounts or multi-device synchronization.',
      discussion_trace: ['The sample team chose explicit decision receipts over a general task board.'],
      tradeoffs: ['No cloud sync or collaboration in the MVP.'], member_suggestions: ['Keep the scope to one offline page.'],
      status: 'refined', critical_dependencies: [{ dependency_id: 'local-storage', must_have: true,
        description: 'Persist a small set of text decision receipts using browser localStorage; no sensitive records.' }] } } };
  if (kind === 'duplicate') Object.assign(base.payload.candidate, {
    title: 'Card Board', target_user: 'Small teams managing tasks with a kanban board',
    problem: 'Teams need to track tasks across To do, Doing and Done columns.',
    solution: 'Create boards with columns and cards; edit and drag cards between columns, with labels and due dates. No claimed differentiator from existing kanban products.',
    mvp: 'A local browser kanban board with editable cards, columns, labels, due dates and drag-and-drop. No backend.',
    discussion_trace: ['The sample team explicitly accepted a generic kanban scope.'],
    tradeoffs: ['No differentiation; only a smaller implementation.'], member_suggestions: [],
    critical_dependencies: [{ dependency_id: 'local-storage', must_have: true,
      description: 'Persist a small set of kanban boards and card records using browser localStorage; no sensitive records.' }] });
  if (kind === 'blocker') Object.assign(base.payload.candidate, {
    title: 'Permission-free Voice Recorder', target_user: 'People who want to record their own voice in a browser',
    problem: 'The idea requires recording to continue even after the user denies microphone permission.',
    solution: 'A normal browser webpage uses navigator.mediaDevices.getUserMedia to capture microphone audio after the browser user explicitly denies microphone permission. No extension, native app or alternate input is permitted.',
    mvp: 'A page that actually records microphone audio despite denied browser permission. Requiring permission is outside the allowed scope.',
    discussion_trace: ['The denial condition is a deliberately impossible test requirement.'],
    tradeoffs: ['No change of requirement allowed in this test.'], member_suggestions: [],
    critical_dependencies: [{ dependency_id: 'denied-microphone', must_have: true,
      description: 'getUserMedia must return a live microphone stream after permission is explicitly denied.' }] });
  if (kind === 'investigate') {
    base.payload.question = { issue_id: 'microphone-permission',
      text: 'Does browser getUserMedia permit microphone capture after a user explicitly denies permission?',
      expected_information: 'Official API documentation and the documented rejection/error behavior.' };
    delete base.payload.room_config.time_limit;
  }
  if (kind === 'preflight') delete base.payload.room_config.time_limit;
  if (kind === 'feasible') {
    base.payload.candidate.critical_dependencies[0].description += ' Documentation lead, not evidence until read: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage .';
    base.payload.candidate.mvp += ' The page is served from localhost HTTP or HTTPS, not opened as a file: URL; it remains usable without remote services after loading. Target current Chrome and Firefox.';
    base.payload.candidate.critical_dependencies.push({ dependency_id: 'json-file-export', must_have: true,
      description: 'Generate a JSON file client-side using JSON.stringify, Blob, URL.createObjectURL and an anchor download; no remote export service. Documentation leads, not proof until actually read: https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static and https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob .' });
  }
  return base;
}

async function services() {
  setup();
  if (runtime.model.provider !== 'deepseek') throw Error('Service smoke currently expects the DeepSeek provider.');
  const start = Date.now();
  // Beta applies to generation; model listing remains on the standard official endpoint.
  const listingBase = runtime.model.baseUrl === 'https://api.deepseek.com/beta' ? 'https://api.deepseek.com' : runtime.model.baseUrl;
  const response = await fetch(new URL('models', listingBase.replace(/\/?$/, '/')), {
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  const listed = { http_status: response.status, elapsed_ms: Date.now() - start, selected_model: runtime.model.id,
    available_models: Array.isArray(body.data) ? body.data.map(m => m.id) : [],
    error: response.ok ? null : { type: body.error?.type ?? 'provider_error', message: body.error?.message ?? 'Model listing failed' } };
  save('models.json', listed); log({ stage: 'model-list', ...listed });
  if (!response.ok) throw Error(`DeepSeek models endpoint returned HTTP ${response.status}`);
  const stream = runtime.streamFn(runtime.model, { systemPrompt: 'Return only the requested JSON. Do not use tools.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Return exactly {"marker":"live-model-ok"}.' }], timestamp: Date.now() }] },
    { signal: AbortSignal.timeout(45000) });
  const message = await stream.result();
  const smoke = { stop_reason: message.stopReason, text: message.content.filter(c => c.type === 'text').map(c => c.text).join(''),
    usage: message.usage, error: message.errorMessage };
  save('model-smoke.json', smoke); log({ stage: 'model-smoke', ...smoke });
  if (message.stopReason !== 'stop' || JSON.parse(smoke.text).marker !== 'live-model-ok') throw Error('Live model smoke failed');
  const found = await retrieval.search('MDN MediaDevices getUserMedia microphone permission API',
    { limit: 2, signal: AbortSignal.timeout(30000) });
  save('retrieval-search.json', found); log({ stage: 'search-smoke', results: found.results.map(v => ({ title: v.title, url: v.url })) });
  const url = found.results.find(v => new URL(v.url).hostname === 'developer.mozilla.org')?.url;
  if (!url) throw Error('Search smoke did not return the intended official source');
  const read = await retrieval.read(url, { signal: AbortSignal.timeout(30000) });
  save('retrieval-read.json', read); log({ stage: 'read-smoke', url, characters: read.content.length });
  runs.push({ case: 'services', status: 'passed', model: runtime.model.id, source: url });
}

async function evaluate(kind) {
  const input = request(kind), start = Date.now(), calls = [], turns = [], wire = [], deltas = [], toolResults = new Map();
  save(`${kind}-request.json`, input);
  if (kind !== 'preflight') setup();
  const traced = kind === 'preflight' ? undefined : Object.fromEntries(['search', 'read'].map(method => [method, async (value, options) => {
    const started = Date.now(), scope = method === 'search' ? { include_domains: options?.includeDomains ?? [] } : {};
    log({ case: kind, tool: method, input: value, phase: 'start', ...scope });
    try {
      const output = await retrieval[method](value, options);
      const entry = { tool: method, input: value, ...scope, elapsed_ms: Date.now() - started, status: 'ok',
        ...(method === 'search' ? { results: output.results.map(v => ({ title: v.title, url: v.url })) } :
          { url: output.url, characters: output.content.length }) };
      calls.push(entry); log({ case: kind, ...entry }); return output;
    } catch (e) {
      const entry = { tool: method, input: value, ...scope, elapsed_ms: Date.now() - started, status: 'error', code: e.code ?? 'TOOL_ERROR' };
      calls.push(entry); log({ case: kind, ...entry }); throw e;
    }
  }]));
  const streamFn = kind === 'preflight' ? undefined : (model, context, options) => {
    for (const message of context.messages) if (message.role === 'toolResult')
      toolResults.set(message.toolCallId, { tool_call_id: message.toolCallId, tool: message.toolName,
        is_error: message.isError, content: message.content });
    const stream = runtime.streamFn(model, context, { ...options,
      fetch: async (url, init) => {
        const body = JSON.parse(init.body);
        wire.push({ model: body.model, endpoint: String(url), response_format: body.response_format, thinking: body.thinking,
          tool_choice: body.tool_choice, max_tokens: body.max_tokens, tools: body.tools?.map(t => ({ name: t.function?.name, strict: t.function?.strict })) });
        return fetch(url, init);
      },
      onProviderStreamEvent: event => {
        const chunks = event?.choices?.map(c => ({ content: c.delta?.content, finish_reason: c.finish_reason }))
          .filter(c => c.content || c.finish_reason);
        if (chunks?.length) deltas.push(...chunks);
      } });
    stream.result().then(message => turns.push({ stop_reason: message.stopReason, usage: message.usage,
      error: message.errorMessage, tool_calls: message.content.filter(c => c.type === 'toolCall'),
      text: message.content.filter(c => c.type === 'text').map(c => c.text).join('') }));
    return stream;
  };
  const output = await runEvaluator({ request: input, model: runtime?.model, streamFn, retrieval: traced, officialDomains: domains, maxTurns: 12 });
  save(`${kind}-response.json`, output); save(`${kind}-tools.json`, calls); save(`${kind}-model-turns.json`, turns);
  save(`${kind}-wire.json`, wire); save(`${kind}-content-deltas.json`, deltas);
  save(`${kind}-tool-feedback.json`, [...toolResults.values()]);
  const checks = { envelope: output.request_id === input.request_id && output.room_id === input.room_id,
    identity: output.data.candidate_id === input.payload.candidate.candidate_id && output.data.version === 2,
    no_fixture: !output.data.fixture };
  if (kind === 'preflight') Object.assign(checks, { needs_input: output.status === 'needs_input',
    no_verdict: !('passed' in output.data), no_external_calls: calls.length === 0 });
  else Object.assign(checks, { acceptable_execution: output.status === 'ok' || (kind === 'blocker' && output.status === 'partial'),
    typed_submission: turns.some(t => t.tool_calls.some(c => c.name === 'submit_report')),
    real_sources: output.data.sources?.some(s => s.url && ['official_documentation', 'public_web', 'project_self_report'].includes(s.source_kind)) === true,
    api_access: calls.length > 0 });
  if (['feasible', 'duplicate', 'blocker'].includes(kind)) Object.assign(checks, {
    minimum_platform_attempts: output.data.novelty_coverage?.scopes.every(s => s.attempts > 0) === true,
    domain_filtered_calls: ['github.com', 'devpost.com'].every(domain => calls.some(c =>
      c.tool === 'search' && c.include_domains?.includes(domain) && c.input.includes(`site:${domain}`))),
    honest_coverage_verdict: output.data.novelty_coverage?.complete === true || output.data.tests?.novelty.result !== 'pass',
  });
  if (kind === 'duplicate') checks.expected_novelty_rejection = output.data.tests?.novelty.result === 'fail';
  if (kind === 'feasible') {
    checks.expected_feasibility_pass = output.data.tests?.feasibility.result === 'pass';
    // A controlled source-content check: a real but unrelated MDN page is not export proof.
    const supportedBy = (id, pattern) => output.data.technical_checks?.find(c => c.dependency_id === id)?.evidence_ids
      .some(eid => output.data.sources?.some(s => s.evidence_id === eid && s.source_kind === 'official_documentation' && pattern.test(s.url ?? ''))) === true;
    checks.storage_documentation = supportedBy('local-storage', /developer\.mozilla\.org\/.*\/(?:Window\/localStorage|Web_Storage_API)/);
    checks.export_documentation = supportedBy('json-file-export', /developer\.mozilla\.org\/.*\/(?:Blob|URL\/createObjectURL|Schemes\/blob|HTMLAnchorElement|a(?:$|\/))/);
  }
  if (kind === 'blocker') checks.expected_feasibility_rejection = output.data.tests?.feasibility.result === 'fail';
  if (kind === 'investigate') checks.permission_blocker = output.data.outcome === 'blocker';
  const summary = { case: kind, status: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
    elapsed_ms: Date.now() - start, checks, execution_status: output.status, passed: output.data.passed,
    tests: output.data.tests, novelty_coverage: output.data.novelty_coverage, answer: output.data.answer, outcome: output.data.outcome,
    sources: output.data.sources?.map(s => ({ id: s.evidence_id, url: s.url, conclusion: s.conclusion })),
    calls: calls.length, model_turns: turns.length, error: output.error };
  runs.push(summary); log(summary);
}

try {
  if (scenario === 'all' || scenario === 'preflight') await evaluate('preflight');
  if (scenario === 'all' || scenario === 'services') await services();
  for (const kind of ['feasible', 'duplicate', 'blocker', 'investigate'])
    if (scenario === 'all' || scenario === kind) await evaluate(kind);
} catch (e) {
  runs.push({ case: scenario, status: 'error', error: { code: e.code ?? 'LIVE_TEST_ERROR', message: e.message } });
  log(runs.at(-1));
} finally {
  save('summary.json', { started_with: scenario, created_at: new Date().toISOString(), runtime: process.version,
    model: runtime?.model.id, model_endpoint: runtime?.model.baseUrl,
    retrieval: process.env.EVALUATOR_RETRIEVAL === 'api' ? 'http' : process.env.TVLY_PYTHON ? 'cli-python-compat' : 'cli', runs }); save('events.json', events);
  console.log(`Results: ${directory}`);
  if (runs.some(r => r.status !== 'passed')) process.exitCode = 1;
}
