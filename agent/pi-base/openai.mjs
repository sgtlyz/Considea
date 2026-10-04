import { builtinModels } from '@earendil-works/pi-ai/providers/all';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const configError = message => Object.assign(new Error(message), { code: 'CONFIG_ERROR', baseError: true });
const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

/** Server-owned authentication and finite transport limits. Construction is offline. */
export function createOpenAIRuntime({ env = process.env, maxModelRequests = 6, maxTokens = 4096,
  timeoutMs = 60_000, fetch: fetchImplementation = globalThis.fetch } = {}) {
  const apiKey = env.OPENAI_API_KEY;
  const id = env.OPENAI_MODEL ?? env.PI_MODEL;
  if (typeof apiKey !== 'string' || !apiKey.startsWith('sk-') || /\s|[\x00-\x1f\x7f]/u.test(apiKey))
    throw configError('Set OPENAI_API_KEY to an OpenAI API key in the server environment');
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id))
    throw configError('Set OPENAI_MODEL (or PI_MODEL) to an explicit OpenAI model identifier');
  const models = builtinModels();
  const catalogModel = models.getModel('openai', id);
  if (!catalogModel || catalogModel.api !== 'openai-responses')
    throw configError('OpenAI model is absent from the pinned Pi catalog; configure a supported model');
  if (!bounded(maxModelRequests, 1, 32) || !bounded(maxTokens, 16, 16384) ||
      !bounded(timeoutMs, 1, 120_000) || typeof fetchImplementation !== 'function')
    throw configError('Invalid OpenAI request, token, or timeout limit');
  const model = Object.freeze({ ...catalogModel, baseUrl: OPENAI_BASE_URL,
    maxTokens: Math.min(maxTokens, catalogModel.maxTokens) });
  let calls = 0;
  const transport = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== `${OPENAI_BASE_URL}/responses`) throw configError('Unexpected OpenAI endpoint');
    if (calls >= maxModelRequests) throw configError('OpenAI model request budget exhausted');
    calls++;
    return fetchImplementation(input, { ...init, redirect: 'error' });
  };
  return { model, get requestCount() { return calls; },
    streamFn(_requestedModel, context, options = {}) {
      const tokens = options.maxTokens ?? model.maxTokens;
      const timeout = options.timeoutMs ?? timeoutMs;
      if (!bounded(tokens, 16, Number.MAX_SAFE_INTEGER) || !bounded(timeout, 1, Number.MAX_SAFE_INTEGER))
        throw configError('Per-request token and timeout limits must be positive integers (at least 16 tokens)');
      return models.streamSimple(model, context, {
        apiKey, fetch: transport, signal: options.signal, toolChoice: options.toolChoice,
        maxTokens: Math.min(tokens, model.maxTokens), timeoutMs: Math.min(timeout, timeoutMs),
        maxRetries: 0, maxRetryDelayMs: 0, cacheRetention: 'none',
        // Tavily stays an application function tool; only final text is constrained to JSON.
        onPayload: payload => ({ ...payload, store: false, text: { ...payload.text, format: { type: 'json_object' } } }),
      });
    },
  };
}
