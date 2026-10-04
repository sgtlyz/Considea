import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { createDeepSeekRuntime } from '../idea/runtime.mjs';

export function liveRuntime() {
  if ((process.env.PI_PROVIDER ?? 'deepseek') === 'deepseek') return createDeepSeekRuntime();
  const models = builtinModels();
  const model = models.getModel(process.env.PI_PROVIDER, process.env.PI_MODEL);
  if (!model) throw Object.assign(new Error('Configure PI_PROVIDER / PI_MODEL or DeepSeek'), { code: 'CONFIG_ERROR' });
  return { model, streamFn: (m, context, options) => models.streamSimple(m, context,
    { ...options, maxTokens: 4096, maxRetries: 0 }) };
}
