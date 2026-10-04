import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { error } from './contracts.mjs';

export function createModelRuntime(env = process.env) {
  const selected = env.EVALUATOR_PROVIDER ?? 'deepseek';
  if (!['deepseek', 'gemini'].includes(selected)) throw error('CONFIG_ERROR', 'EVALUATOR_PROVIDER must be deepseek or gemini');
  const provider = selected === 'gemini' ? 'google' : 'deepseek';
  const apiKey = env[selected === 'gemini' ? 'GEMINI_API_KEY' : 'DEEPSEEK_API_KEY'];
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw error('CONFIG_ERROR', `${selected === 'gemini' ? 'GEMINI_API_KEY' : 'DEEPSEEK_API_KEY'} is required`);
  const maxTokens = Number(env.EVALUATOR_MAX_TOKENS ?? 4096);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 16384)
    throw error('CONFIG_ERROR', 'EVALUATOR_MAX_TOKENS must be an integer from 256 to 16384');
  const models = builtinModels(); const id = env.EVALUATOR_MODEL ?? (selected === 'gemini' ? 'gemini-2.5-flash' : 'deepseek-flash');
  if (typeof id !== 'string' || !id.trim()) throw error('CONFIG_ERROR', 'EVALUATOR_MODEL cannot be empty');
  let model = models.getModel(provider, id);
  if (!model && selected === 'deepseek') {
    // Explicit legacy/custom non-reasoning model configuration, rather than pretending it is in Pi's catalog.
    model = { ...models.getModel('deepseek', 'deepseek-flash'), id, name: id, input: ['text'], reasoning: false,
      contextWindow: 64000, maxTokens: 8192, compat: { supportsStore: false, supportsDeveloperRole: false,
        supportsStrictMode: false, maxTokensField: 'max_tokens' } };
  }
  if (!model) throw error('CONFIG_ERROR', 'Model is absent from the pinned Pi catalog; configure a supported model');
  if (env.EVALUATOR_BASE_URL) {
    let url; try { url = new URL(env.EVALUATOR_BASE_URL); } catch { /* handled below */ }
    if (selected !== 'deepseek' || !url || url.protocol !== 'https:' || url.username || url.password)
      throw error('CONFIG_ERROR', 'EVALUATOR_BASE_URL requires a trusted HTTPS DeepSeek-compatible endpoint');
    model = { ...model, baseUrl: env.EVALUATOR_BASE_URL };
  }
  return { model, streamFn: (m, context, options) => models.streamSimple(m, context,
    { ...options, apiKey, maxTokens: Math.min(maxTokens, m.maxTokens), reasoning: 'off' }) };
}
