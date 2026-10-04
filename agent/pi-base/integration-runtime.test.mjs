import test from 'node:test';
import assert from 'node:assert/strict';
import { liveRuntime } from './integration-runtime.mjs';
import { openaiResponse } from './test-fixtures/openai.mjs';
import { createBoundedLiveRuntime } from '../interview/live-runtime.mjs';

const env = { PI_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-4.1-mini', OPENAI_API_KEY: 'sk-offline-room-key',
  DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_API_KEY: 'unused-deepseek-key' };
const context = { systemPrompt: 'Return JSON.', messages: [{ role: 'user', content: 'Return JSON.', timestamp: 1 }] };

test('OpenAI uses explicit per-room configuration and the official Responses endpoint', async () => {
  const requests = [];
  const runtime = liveRuntime({ env, maxTokens: 500, maxModelRequests: 2,
    fetch: async (url, init) => { requests.push({ url: String(url), init }); return openaiResponse(); } });
  assert.equal(runtime.model.provider, 'openai');
  assert.equal(runtime.model.id, 'gpt-4.1-mini');
  assert.equal(runtime.requestCount, 0, 'construction makes no requests');
  const result = await runtime.streamFn({ ...runtime.model, baseUrl: 'https://untrusted.example' }, context,
    { apiKey: 'sk-must-not-be-used', fetch: () => assert.fail('operation cannot replace transport'), maxTokens: 9000 }).result();
  assert.equal(result.stopReason, 'stop');
  assert.equal(result.content[0].text, '{"ok":true}');
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'Bearer sk-offline-room-key');
  assert.equal(requests[0].init.redirect, 'error');
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, 'gpt-4.1-mini');
  assert.equal(body.max_output_tokens, 500);
  assert.equal(body.store, false);
  assert.deepEqual(body.text.format, { type: 'json_object' });
  assert.equal(body.thinking, undefined);
});

test('OpenAI accepts PI_MODEL and requires its own key and a supported model', () => {
  assert.equal(liveRuntime({ env: { PI_PROVIDER: 'openai', PI_MODEL: 'gpt-4.1-mini', OPENAI_API_KEY: 'sk-fixture' } }).model.id, 'gpt-4.1-mini');
  for (const changes of [{ OPENAI_API_KEY: '' }, { OPENAI_API_KEY: 'secret invalid key' },
    { OPENAI_MODEL: '' }, { OPENAI_MODEL: 'nonexistent-model' }, { OPENAI_MODEL: 'https://untrusted.example' }]) {
    assert.throws(() => liveRuntime({ env: { ...env, ...changes } }), error =>
      error.code === 'CONFIG_ERROR' && !error.message.includes('secret'));
  }
});

test('OpenAI request budget and no retries bound failed provider calls', async () => {
  let calls = 0;
  const runtime = liveRuntime({ env, maxModelRequests: 1, fetch: async () => {
    calls++; return new Response('{"error":{"message":"Unavailable"}}', { status: 503 });
  } });
  assert.equal((await runtime.streamFn(runtime.model, context).result()).stopReason, 'error');
  assert.equal((await runtime.streamFn(runtime.model, context).result()).stopReason, 'error');
  assert.equal(calls, 1);
  assert.equal(runtime.requestCount, 1);
});

test('standalone Interview selects OpenAI and keeps its hard per-process call limit', async () => {
  let calls = 0;
  const runtime = createBoundedLiveRuntime({ env, maxCalls: 1, fetch: async () => { calls++; return openaiResponse(); } });
  assert.equal(runtime.model.provider, 'openai');
  assert.equal((await runtime.streamFn(runtime.model, context).result()).stopReason, 'stop');
  assert.throws(() => runtime.streamFn(runtime.model, context), /call limit/);
  assert.equal(calls, 1);
});

test('OpenAI rejects invalid limits before requests and propagates caller cancellation without retry', async () => {
  for (const options of [{ maxModelRequests: 0 }, { maxModelRequests: 33 }, { maxTokens: 0 },
    { maxTokens: 15 }, { maxTokens: 16385 }, { timeoutMs: 0 }, { timeoutMs: 120001 }, { fetch: null }])
    assert.throws(() => liveRuntime({ env, ...options }), { code: 'CONFIG_ERROR' });
  let calls = 0, started;
  const controller = new AbortController();
  const ready = new Promise(resolve => { started = resolve; });
  const runtime = liveRuntime({ env, fetch: async (_url, init) => {
    calls++; started();
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  } });
  const stream = runtime.streamFn(runtime.model, context, { signal: controller.signal });
  await ready;
  controller.abort();
  assert.equal((await stream.result()).stopReason, 'aborted');
  assert.equal(calls, 1);
});

test('OpenAI keeps Tavily function calls and matches their results on the next turn', async () => {
  const payloads = [];
  const runtime = liveRuntime({ env, fetch: async (_url, init) => {
    payloads.push(JSON.parse(init.body));
    return payloads.length === 1 ? openaiResponse('', { name: 'tavily_search', arguments: { query: 'official docs' } }) : openaiResponse();
  } });
  const first = await runtime.streamFn(runtime.model, { ...context,
    tools: [{ name: 'tavily_search', description: 'Search with Tavily',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] }).result();
  assert.equal(first.stopReason, 'toolUse');
  assert.equal(first.content[0].name, 'tavily_search');
  assert.deepEqual(first.content[0].arguments, { query: 'official docs' });
  await runtime.streamFn(runtime.model, { ...context, messages: [...context.messages, first,
    { role: 'toolResult', toolCallId: first.content[0].id, toolName: 'tavily_search',
      content: [{ type: 'text', text: 'Official docs' }], isError: false, timestamp: 2 }] }).result();
  assert.equal(payloads[0].tools[0].name, 'tavily_search');
  const output = payloads[1].input.find(item => item.type === 'function_call_output');
  assert.equal(output.call_id, 'call_fixture');
  assert.equal(output.output, 'Official docs');
});
