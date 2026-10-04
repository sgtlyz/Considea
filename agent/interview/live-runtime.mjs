import { createDeepSeekRuntime } from '../pi-base/deepseek.mjs';

/** Hard per-process call/input limits; never instantiated by offline commands. */
export function createBoundedLiveRuntime({ env = process.env, maxCalls = 16 } = {}) {
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 32) throw new Error('maxCalls must be 1..32');
  const runtime = createDeepSeekRuntime({ env });
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
