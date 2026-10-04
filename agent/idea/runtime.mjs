import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { createOpenAIRuntime } from '../pi-base/openai.mjs';

const configError = message => Object.assign(new Error(message), { code: 'CONFIG_ERROR', baseError: true });
const bounded = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max;

export function createIdeaRuntime({ env = process.env, ...options } = {}) {
  const provider = env.PI_PROVIDER ?? 'deepseek';
  if (provider === 'deepseek') return createDeepSeekRuntime({ env, ...options });
  if (provider === 'openai') return createOpenAIRuntime({ env, ...options });
  throw configError('PI_PROVIDER must be deepseek or openai');
}

/** Construction is offline. Model choice and finite transport budget are explicit. No automatic retry. */
export function createDeepSeekRuntime({ env = process.env, maxModelRequests = 6, maxTokens = 4096,
  timeoutMs = 60_000, fetch: fetchImplementation = globalThis.fetch } = {}) {
  const apiKey = env.DEEPSEEK_API_KEY;
  const modelId = env.DEEPSEEK_MODEL;
  if (typeof apiKey !== 'string' || !apiKey || /\s|[\x00-\x1f\x7f]/u.test(apiKey)) throw configError('Set DEEPSEEK_API_KEY in the server environment');
  if (typeof modelId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(modelId)) throw configError('Set DEEPSEEK_MODEL explicitly');
  if (!bounded(maxModelRequests, 12) || !bounded(maxTokens, 8192) || !bounded(timeoutMs, 120_000) || typeof fetchImplementation !== 'function') {
    throw configError('Invalid model request, token, or timeout limit');
  }
  let calls = 0;
  const model = Object.freeze({ id: modelId, name: modelId, api: 'openai-completions', provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1', reasoning: false, input: ['text'], contextWindow: 32768, maxTokens,
    // Required SDK fields; these zeroes are not measured prices and must never be used for billing.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
      supportsUsageInStreaming: true, supportsStrictMode: false, supportsLongCacheRetention: false,
      maxTokensField: 'max_tokens', thinkingFormat: 'deepseek' } });
  const transport = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://api.deepseek.com/v1/chat/completions') throw configError('Unexpected model endpoint');
    if (calls >= maxModelRequests) throw configError('Model request budget exhausted');
    calls++;
    return fetchImplementation(input, { ...init, redirect: 'error' });
  };
  return { model, get requestCount() { return calls; }, streamFn: (_model, context, options = {}) =>
    streamSimple(model, context, { apiKey, fetch: transport, signal: options.signal, maxTokens,
      timeoutMs, maxRetries: 0, maxRetryDelayMs: 0, cacheRetention: 'none',
      onPayload: payload => ({ ...payload, response_format: { type: 'json_object' }, thinking: { type: 'disabled' } }),
    }) };
}
