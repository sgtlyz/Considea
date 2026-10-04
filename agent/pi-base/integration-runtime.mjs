import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { createDeepSeekRuntime } from '../idea/runtime.mjs';

export function liveRuntime({ env = process.env } = {}) {
  if ((env.PI_PROVIDER ?? 'deepseek') === 'deepseek') return createDeepSeekRuntime({env});
  const models = builtinModels();
  const model = models.getModel(env.PI_PROVIDER, env.PI_MODEL);
  if (!model) throw Object.assign(new Error('Configure PI_PROVIDER / PI_MODEL or DeepSeek'), { code: 'CONFIG_ERROR' });
  return { model, streamFn: (m, context, options) => models.streamSimple(m, context,
    { ...options, maxTokens: 4096, maxRetries: 0 }) };
}
