import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRuntime } from '../models.mjs';

test('DeepSeek and Gemini configurations produce Pi models without making remote calls', () => {
  const d = createModelRuntime({ EVALUATOR_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'fixture', EVALUATOR_MODEL: 'deepseek-flash' });
  assert.equal(d.model.provider, 'deepseek'); assert.equal(d.model.api, 'openai-completions');
  assert.equal(d.model.baseUrl, 'https://api.deepseek.com/beta'); assert.equal(typeof d.streamFn, 'function');
  const g = createModelRuntime({ EVALUATOR_PROVIDER: 'gemini', GEMINI_API_KEY: 'fixture', EVALUATOR_MODEL: 'gemini-2.5-flash' });
  assert.equal(g.model.provider, 'google'); assert.equal(g.model.api, 'google-generative-ai');
});
test('custom DeepSeek model IDs and trusted base URL can be configured explicitly', () => {
  const d = createModelRuntime({ EVALUATOR_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'fixture',
    EVALUATOR_MODEL: 'deepseek-chat', EVALUATOR_BASE_URL: 'https://api.deepseek.com/v1' });
  assert.equal(d.model.id, 'deepseek-chat'); assert.equal(d.model.baseUrl, 'https://api.deepseek.com/v1');
});
test('missing keys, bad provider and invalid token limits are configuration errors', () => {
  for (const env of [{}, { EVALUATOR_PROVIDER: 'unknown', DEEPSEEK_API_KEY: 'secret' },
    { DEEPSEEK_API_KEY: 'secret', EVALUATOR_MAX_TOKENS: '-1' },
    { DEEPSEEK_API_KEY: 'secret', EVALUATOR_BASE_URL: 'file:///secret' }])
    assert.throws(() => createModelRuntime(env), e => e.code === 'CONFIG_ERROR' && !e.message.includes('secret'));
});
test('DeepSeek wire requests enforce JSON output and retain tools without a real API call', async () => {
  const runtime = createModelRuntime({ DEEPSEEK_API_KEY: 'fixture', EVALUATOR_STRICT_TOOLS: '0' }); let payload;
  const stream = runtime.streamFn(runtime.model, { systemPrompt: 'Return JSON.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Return {}.' }], timestamp: 1 }],
    tools: [{ name: 'lookup', description: 'Read evidence', parameters: { type: 'object', properties: {} } }] },
    { toolChoice: 'required', fetch: async (_url, init) => {
      payload = JSON.parse(init.body);
      return new Response('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'deepseek-flash',
        choices: [{ index: 0, delta: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } });
    } });
  assert.equal((await stream.result()).stopReason, 'stop');
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.equal(payload.tools[0].function.name, 'lookup');
  assert.equal(payload.tool_choice, 'required');
  assert.deepEqual(payload.thinking, { type: 'disabled' });
});

test('strict DeepSeek wire schemas require fields without weakening local tool constraints', async () => {
  const runtime = createModelRuntime({ DEEPSEEK_API_KEY: 'fixture' }); let payload, endpoint;
  const parameters = { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 400 },
    limit: { type: 'integer', minimum: 1, maximum: 10 }, id: { type: 'string', const: 'candidate-2' } }, required: ['query', 'id'] };
  await runtime.streamFn(runtime.model, { systemPrompt: 'Use tool.', messages: [{ role: 'user',
    content: [{ type: 'text', text: 'Search.' }], timestamp: 1 }],
    tools: [{ name: 'search', description: 'Read sources', parameters }] }, { fetch: async (url, init) => {
      endpoint = url; payload = JSON.parse(init.body);
      return new Response('data: ' + JSON.stringify({ id: 'fixture', model: 'deepseek-flash',
        choices: [{ index: 0, delta: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } });
    } }).result();
  assert.match(String(endpoint), /\/beta\/chat\/completions$/);
  const tool = payload.tools[0].function;
  assert.equal(tool.strict, true); assert.equal(tool.parameters.additionalProperties, false);
  assert.deepEqual(tool.parameters.required, ['query', 'limit', 'id']);
  assert.deepEqual(tool.parameters.properties.id.enum, ['candidate-2']);
  assert.equal(tool.parameters.properties.query.minLength, undefined);
  assert.equal(parameters.properties.query.minLength, 1); assert.deepEqual(parameters.required, ['query', 'id']);
  assert.equal(payload.response_format, undefined);
});
