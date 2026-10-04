import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const configurationError = message => Object.assign(new Error(message), {
  code: 'CONFIG_ERROR', baseError: true,
});
const positiveInteger = value => Number.isInteger(value) && value > 0;

/** Construct a server-side Pi runtime. Construction never calls the provider. */
export function createDeepSeekRuntime({ env = process.env, maxTokens = 2048,
  timeoutMs = 60_000, fetch: fetchImplementation = globalThis.fetch } = {}) {
  const apiKey = env?.DEEPSEEK_API_KEY;
  const modelId = env?.DEEPSEEK_MODEL;
  if (typeof apiKey !== 'string' || !apiKey.length || /\s|[\x00-\x1f\x7f]/u.test(apiKey)) {
    throw configurationError('Set DEEPSEEK_API_KEY in the local server environment before live testing');
  }
  if (typeof modelId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(modelId)) {
    throw configurationError('Set DEEPSEEK_MODEL to an explicit DeepSeek model identifier');
  }
  if (!positiveInteger(maxTokens) || maxTokens > 4096) {
    throw configurationError('DeepSeek maxTokens must be an integer from 1 to 4096');
  }
  if (!positiveInteger(timeoutMs) || timeoutMs > 120_000) {
    throw configurationError('DeepSeek timeoutMs must be an integer from 1 to 120000');
  }
  if (typeof fetchImplementation !== 'function') {
    throw configurationError('A fetch implementation is required');
  }

  const model = Object.freeze({
    id: modelId, name: modelId, api: 'openai-completions', provider: 'deepseek',
    baseUrl: DEEPSEEK_BASE_URL, reasoning: false, input: Object.freeze(['text']),
    // A conservative application window, not a claim about the provider's maximum.
    contextWindow: 32768, maxTokens,
    // Pricing is intentionally unavailable here; these placeholders must not be used
    // as a billing estimate. Live testing is bounded by request and token counts.
    cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
    compat: Object.freeze({ supportsStore: false, supportsDeveloperRole: false,
      supportsReasoningEffort: false, supportsUsageInStreaming: true,
      supportsStrictMode: false, supportsLongCacheRetention: false,
      maxTokensField: 'max_tokens', thinkingFormat: 'deepseek' }),
  });
  const providerFetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== `${DEEPSEEK_BASE_URL}/chat/completions`) {
      throw configurationError('DeepSeek requests must use the official chat completions endpoint');
    }
    return fetchImplementation(input, { ...init, redirect: 'error' });
  };

  // The runtime owns transport/authentication/policy. Per-operation options can
  // abort or lower limits, but cannot replace the endpoint, key, fetch, or payload.
  const streamFn = (_requestedModel, context, options = {}) => {
    const requestedTokens = options.maxTokens ?? maxTokens;
    const requestedTimeout = options.timeoutMs ?? timeoutMs;
    if (!positiveInteger(requestedTokens) || !positiveInteger(requestedTimeout)) {
      throw configurationError('Per-request token and timeout limits must be positive integers');
    }
    return streamSimple(model, context, {
      apiKey, fetch: providerFetch, signal: options.signal,
      maxTokens: Math.min(requestedTokens, maxTokens),
      timeoutMs: Math.min(requestedTimeout, timeoutMs),
      maxRetries: 0, maxRetryDelayMs: 0, cacheRetention: 'none',
      onPayload: payload => ({ ...payload,
        response_format: { type: 'json_object' }, thinking: { type: 'disabled' },
      }),
    });
  };
  return { model, streamFn };
}
