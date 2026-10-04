import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekRuntime, DEEPSEEK_BASE_URL } from './deepseek.mjs';
import { runAgent } from './base.mjs';

const environment = { DEEPSEEK_API_KEY: 'dummy-key-for-offline-tests', DEEPSEEK_MODEL: 'deepseek-flash' };
const context = () => ({ messages: [
  { role: 'system', content: 'Return a JSON object.', timestamp: 0 },
  { role: 'user', content: 'Say hello as JSON.', timestamp: 0 }] });
const successResponse = (content = '{"hello":"world"}') => {
  const chunks = [
    { id: 'offline', object: 'chat.completion.chunk', choices: [
      { index: 0, delta: { role: 'assistant', content }, finish_reason: null }] },
    { id: 'offline', object: 'chat.completion.chunk', choices: [
      { index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } },
  ];
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200, headers: { 'Content-Type': 'text/event-stream' },
  });
};

test('construction is offline and requires an explicit DeepSeek key/model', () => {
  let calls = 0;
  const fetch = () => { calls++; throw new Error('Unexpected network'); };
  const runtime = createDeepSeekRuntime({ env: environment, fetch });
  assert.equal(runtime.model.id, 'deepseek-flash');
  assert.equal(runtime.model.baseUrl, DEEPSEEK_BASE_URL);
  assert.equal(calls, 0);
  for (const env of [{}, { OPENAI_API_KEY: 'must-not-be-used', DEEPSEEK_MODEL: 'deepseek-flash' },
    { DEEPSEEK_API_KEY: 'dummy' }, { ...environment, DEEPSEEK_API_KEY: 'invalid key secret' },
    { ...environment, DEEPSEEK_MODEL: 'https://untrusted.test' }]) {
    assert.throws(() => createDeepSeekRuntime({ env, fetch }), error =>
      error.code === 'CONFIG_ERROR' && !error.message.includes('secret') && !error.message.includes('must-not-be-used'));
  }
  assert.equal(calls, 0);
});

test('real Pi serialization fixes the official endpoint, JSON, nonthinking, and output cap', async () => {
  const requests = [];
  const runtime = createDeepSeekRuntime({ env: environment, maxTokens: 2048,
    fetch: async (url, init) => { requests.push({ url: String(url), init }); return successResponse(); } });
  const result = await runtime.streamFn({ ...runtime.model, baseUrl: 'https://untrusted.test' }, context(), {
    apiKey: 'must-not-be-used', maxTokens: 99999, maxRetries: 99,
    headers: { Authorization: 'Bearer must-not-be-used' }, reasoning: 'high',
    samplingParams: { thinking: { type: 'enabled' } },
    onPayload: () => { throw new Error('Untrusted override must not run'); },
  }).result();
  assert.equal(result.stopReason, 'stop');
  assert.equal(result.content[0].text, '{"hello":"world"}');
  assert.equal(requests.length, 1);
  const { url, init } = requests[0];
  assert.equal(url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${environment.DEEPSEEK_API_KEY}`);
  const body = JSON.parse(init.body);
  assert.equal(body.model, environment.DEEPSEEK_MODEL);
  assert.equal(body.max_tokens, 2048);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.stream, true);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].content, 'Say hello as JSON.');
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.store, undefined);
});

test('per-call output cap may be lowered', async () => {
  let body;
  const runtime = createDeepSeekRuntime({ env: environment,
    fetch: async (_url, init) => { body = JSON.parse(init.body); return successResponse(); } });
  await runtime.streamFn(runtime.model, context(), { maxTokens: 256 }).result();
  assert.equal(body.max_tokens, 256);
});

for (const status of [429, 500]) {
  test(`HTTP ${status} makes exactly one attempt`, async () => {
    let calls = 0;
    const runtime = createDeepSeekRuntime({ env: environment,
      fetch: async () => { calls++; return new Response(JSON.stringify({ error: { message: 'offline failure' } }), {
        status, headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
      }); } });
    const result = await runtime.streamFn(runtime.model, context()).result();
    assert.equal(result.stopReason, 'error');
    assert.equal(calls, 1);
  });
}

test('caller abort reaches the injected HTTP transport without retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  let start;
  const started = new Promise(resolve => { start = resolve; });
  const runtime = createDeepSeekRuntime({ env: environment,
    fetch: async (_url, init) => {
      calls++;
      start();
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted offline request', 'AbortError'));
        if (init.signal.aborted) abort();
        else init.signal.addEventListener('abort', abort, { once: true });
      });
    } });
  const resultPromise = runtime.streamFn(runtime.model, context(), { signal: controller.signal }).result();
  await started;
  controller.abort();
  assert.equal((await resultPromise).stopReason, 'aborted');
  assert.equal(calls, 1);
});

test('HTTP timeout aborts the transport without retry', async () => {
  let calls = 0;
  const runtime = createDeepSeekRuntime({ env: environment, timeoutMs: 20,
    fetch: async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException('Timed out offline request', 'AbortError'));
        if (init.signal.aborted) abort();
        else init.signal.addEventListener('abort', abort, { once: true });
      });
    } });
  const result = await runtime.streamFn(runtime.model, context()).result();
  assert.equal(result.stopReason, 'error');
  assert.equal(calls, 1);
});

test('the real Pi Agent passes its system prompt through the adapter', async () => {
  let body;
  const runtime = createDeepSeekRuntime({ env: environment,
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return successResponse(JSON.stringify({ status: 'ok', data: { answer: 'ok' }, warnings: [] }));
    } });
  const result = await runAgent({ ...runtime,
    request: { schema_version: '1.0', request_id: 'offline-1', room_id: 'offline-room',
      operation: 'interview.turn', input_revision: 0, payload: { message: 'hello' } },
    definition: { name: 'interview', systemPrompt: 'Protected interview instructions.',
      operations: { 'interview.turn': { validateInput: () => true,
        validateOutput: data => data.answer === 'ok' } } },
  });
  assert.equal(result.status, 'ok');
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /Protected interview instructions/);
  assert.match(body.messages[0].content, /JSON/);
  const userContent = body.messages[1].content;
  const userText = typeof userContent === 'string' ? userContent : userContent.filter(b => b.type === 'text').map(b => b.text).join('');
  assert.deepEqual(JSON.parse(userText), { message: 'hello' });
});

test('invalid configuration and per-request limits fail before transport', () => {
  for (const extra of [{ maxTokens: 0 }, { maxTokens: 4097 }, { timeoutMs: 0 }, { timeoutMs: 120001 }, { fetch: null }]) {
    assert.throws(() => createDeepSeekRuntime({ env: environment, ...extra }), { code: 'CONFIG_ERROR' });
  }
  const runtime = createDeepSeekRuntime({ env: environment, fetch: () => { throw new Error('Unexpected transport'); } });
  for (const options of [{ maxTokens: -1 }, { maxTokens: 1.5 }, { timeoutMs: NaN }]) {
    assert.throws(() => runtime.streamFn(runtime.model, context(), options), { code: 'CONFIG_ERROR' });
  }
});
