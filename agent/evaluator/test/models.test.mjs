import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRuntime } from '../models.mjs';

test('DeepSeek and Gemini configurations produce Pi models without making remote calls', () => {
  const d = createModelRuntime({ EVALUATOR_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'fixture', EVALUATOR_MODEL: 'deepseek-flash' });
  assert.equal(d.model.provider, 'deepseek'); assert.equal(d.model.api, 'openai-completions');
  assert.equal(d.model.baseUrl, 'https://api.deepseek.com'); assert.equal(typeof d.streamFn, 'function');
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
