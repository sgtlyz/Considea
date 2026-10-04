import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekRuntime } from './runtime.mjs';

const env = { DEEPSEEK_API_KEY: 'offline-test-key', DEEPSEEK_MODEL: 'offline-test-model' };
const context = { messages: [{ role: 'user', content: 'Return JSON.', timestamp: Date.now() }] };
const sse = () => new Response('data: ' + JSON.stringify({ id: 'mock', object: 'chat.completion.chunk',
  created: 1, model: 'offline-test-model', choices: [{ index: 0, delta: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n',
  { headers: { 'Content-Type': 'text/event-stream' } });

test('runtime construction requires explicit credentials, model and bounded requests without network', () => {
  for (const config of [{ env: {} }, { env, maxModelRequests: 0 }, { env, maxTokens: 9000 }, { env, timeoutMs: Infinity }]) {
    assert.throws(() => createDeepSeekRuntime(config), { code: 'CONFIG_ERROR' });
  }
  const runtime = createDeepSeekRuntime({ env, fetch: () => assert.fail('construction must be offline') });
  assert.equal(runtime.requestCount, 0);
});

test('real provider adapter uses fixed endpoint, no retries, explicit token cap and JSON mode', async () => {
  const calls = [];
  const runtime = createDeepSeekRuntime({ env, maxModelRequests: 1, maxTokens: 500, fetch: async (url, init) => {
    calls.push({ url: String(url), init }); return sse();
  } });
  await runtime.streamFn(runtime.model, context).result();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/chat/completions');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.max_tokens, 500);
  assert.equal(body.model, env.DEEPSEEK_MODEL);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(calls[0].init.redirect, 'error');
  await runtime.streamFn(runtime.model, context).result();
  assert.equal(calls.length, 1, 'second HTTP call is blocked by transport budget');
  assert.equal(runtime.requestCount, 1, 'blocked attempts do not count as sent provider requests');
});
