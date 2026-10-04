import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { error } from './contracts.mjs';
import { createOpenAIRuntime } from '../pi-base/openai.mjs';

// DeepSeek's documented strict subset omits string/array length keywords.
// This only adapts the remote schema; Pi and the ledger retain the original validators.
function strictSchema(schema) {
  const value = Object.fromEntries(Object.entries(schema).filter(([k]) =>
    !['minLength', 'maxLength', 'minItems', 'maxItems', 'const'].includes(k)));
  if ('const' in schema) value.enum = [schema.const];
  if (schema.properties) {
    value.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, strictSchema(v)]));
    value.required = Object.keys(value.properties);
    value.additionalProperties = false;
  }
  if (schema.items) value.items = strictSchema(schema.items);
  if (schema.anyOf) value.anyOf = schema.anyOf.map(strictSchema);
  return value;
}

export function createModelRuntime(env = process.env, options = {}) {
  const selected = env.EVALUATOR_PROVIDER ?? env.PI_PROVIDER ?? 'deepseek';
  if (!['deepseek', 'openai', 'gemini'].includes(selected)) throw error('CONFIG_ERROR', 'EVALUATOR_PROVIDER must be deepseek, openai or gemini');
  const provider = selected === 'gemini' ? 'google' : 'deepseek';
  if (env.EVALUATOR_STRICT_TOOLS !== undefined && !['0', '1'].includes(env.EVALUATOR_STRICT_TOOLS))
    throw error('CONFIG_ERROR', 'EVALUATOR_STRICT_TOOLS must be 0 or 1');
  const strictTools = selected === 'deepseek' && (env.EVALUATOR_STRICT_TOOLS === '1' ||
    (env.EVALUATOR_STRICT_TOOLS !== '0' && !env.EVALUATOR_BASE_URL));
  const keyName = selected === 'gemini' ? 'GEMINI_API_KEY' : selected === 'openai' ? 'OPENAI_API_KEY' : 'DEEPSEEK_API_KEY';
  const apiKey = env[keyName];
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw error('CONFIG_ERROR', `${keyName} is required`);
  const maxTokens = Number(env.EVALUATOR_MAX_TOKENS ?? 4096);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 16384)
    throw error('CONFIG_ERROR', 'EVALUATOR_MAX_TOKENS must be an integer from 256 to 16384');
  if (selected === 'openai') {
    if (env.EVALUATOR_BASE_URL) throw error('CONFIG_ERROR', 'OpenAI uses the official Responses endpoint');
    return createOpenAIRuntime({ env: { ...env, OPENAI_MODEL: env.EVALUATOR_MODEL ?? env.OPENAI_MODEL ?? env.PI_MODEL },
      maxTokens, maxModelRequests: 32, fetch: options.fetch ?? globalThis.fetch });
  }
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
  } else if (strictTools) model = { ...model, baseUrl: 'https://api.deepseek.com/beta' };
  return { model, streamFn: (m, context, options) => models.streamSimple(m, context,
    { ...options, apiKey, maxTokens: Math.min(maxTokens, m.maxTokens), reasoning: 'off',
      ...(selected === 'deepseek' ? { onPayload: async (payload, target) => {
        const adjusted = await options?.onPayload?.(payload, target) ?? payload;
        if (strictTools && adjusted.tools?.length) {
          const { response_format: _unused, ...toolPayload } = adjusted;
          return { ...toolPayload, tools: adjusted.tools.map(tool => ({ ...tool, function: {
            ...tool.function, strict: true, parameters: strictSchema(tool.function.parameters),
          } })) };
        }
        return { ...adjusted, response_format: { type: 'json_object' } };
      } } : {}) }) };
}
