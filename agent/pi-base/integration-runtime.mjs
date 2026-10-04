import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { createIdeaRuntime } from '../idea/runtime.mjs';

export function liveRuntime({ env = process.env, ...options } = {}) {
  if (['deepseek', 'openai'].includes(env.PI_PROVIDER ?? 'deepseek')) return createIdeaRuntime({ env, ...options });
  const models = builtinModels();
  const model = models.getModel(env.PI_PROVIDER, env.PI_MODEL);
  if (!model) throw Object.assign(new Error('Configure PI_PROVIDER / PI_MODEL or DeepSeek'), { code: 'CONFIG_ERROR' });
  return { model, streamFn: (m, context, options) => models.streamSimple(m, context,
    { ...options, maxTokens: 4096, maxRetries: 0 }) };
}
