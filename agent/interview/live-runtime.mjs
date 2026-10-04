import { createDeepSeekRuntime } from '../pi-base/deepseek.mjs';
import { createOpenAIRuntime } from '../pi-base/openai.mjs';

/** Hard per-process call/input limits; never instantiated by offline commands. */
export function createBoundedLiveRuntime({ env = process.env, maxCalls = 16, fetch = globalThis.fetch } = {}) {
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 32) throw new Error('maxCalls must be 1..32');
  const provider = env.PI_PROVIDER ?? 'deepseek';
  if (!['deepseek', 'openai'].includes(provider))
    throw Object.assign(new Error('PI_PROVIDER must be deepseek or openai'), { code: 'CONFIG_ERROR' });
  const runtime = provider === 'openai'
    ? createOpenAIRuntime({ env, fetch, maxModelRequests: maxCalls, maxTokens: 2048 })
    : createDeepSeekRuntime({ env, fetch });
  let calls = 0;
  return { model: runtime.model,
    streamFn(model, context, options) {
      if (JSON.stringify(context).length > 48_000) throw new Error('Interview input size limit reached');
      if (calls >= maxCalls) throw new Error('Interview model call limit reached');
      calls++;
      return runtime.streamFn(model, context, options);
    },
    get calls() { return calls; },
  };
}
