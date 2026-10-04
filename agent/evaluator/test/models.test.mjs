import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRuntime } from '../models.mjs';
import { openaiResponse } from '../../pi-base/test-fixtures/openai.mjs';

test('OpenAI evaluator uses its own key/model and retains Tavily tools', async () => {
  let body, endpoint, headers;
  const runtime = createModelRuntime({ PI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-evaluator-fixture',
    OPENAI_MODEL: 'gpt-4.1-mini', DEEPSEEK_API_KEY: 'unused-key', DEEPSEEK_MODEL: 'deepseek-flash' },
  { fetch: async (url, init) => {
    endpoint = String(url); body = JSON.parse(init.body); headers = new Headers(init.headers);
    return openaiResponse('', { name: 'tavily_search', arguments: { query: 'official docs' } });
  } });
  assert.equal(runtime.model.provider, 'openai');
  const result = await runtime.streamFn(runtime.model, { systemPrompt: 'Return JSON.',
    messages: [{ role: 'user', content: 'Search official docs and return JSON.', timestamp: 1 }],
    tools: [{ name: 'tavily_search', description: 'Search sources', parameters: {
      type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] },
  { toolChoice: 'required' }).result();
  assert.equal(endpoint, 'https://api.openai.com/v1/responses');
  assert.equal(headers.get('authorization'), 'Bearer sk-evaluator-fixture');
  assert.equal(body.model, 'gpt-4.1-mini');
  assert.equal(body.tools[0].name, 'tavily_search');
  assert.equal(body.tool_choice, 'required');
  assert.equal(body.thinking, undefined);
  assert.equal(result.stopReason, 'toolUse');
});

test('OpenAI evaluator rejects missing provider keys and models and respects an explicit override', () => {
  for (const config of [ { EVALUATOR_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-4.1-mini', DEEPSEEK_API_KEY: 'unused' },
    { EVALUATOR_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-fixture' } ])
    assert.throws(() => createModelRuntime(config), { code: 'CONFIG_ERROR' });
  const runtime = createModelRuntime({ EVALUATOR_PROVIDER: 'openai', EVALUATOR_MODEL: 'gpt-4.1',
    OPENAI_API_KEY: 'sk-fixture', OPENAI_MODEL: 'gpt-4.1-mini' });
  assert.equal(runtime.model.id, 'gpt-4.1');
});

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
