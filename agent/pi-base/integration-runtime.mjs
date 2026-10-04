import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { createIdeaRuntime } from '../idea/runtime.mjs';

export function liveRuntime({ env = process.env, operation, ...options } = {}) {
  const ideaOperation = ['idea.generate', 'idea.revise'].includes(operation);
  if (ideaOperation) {
    const configured = options.maxTokens ?? env.IDEA_MAX_OUTPUT_TOKENS ?? 8192;
    const tokens = typeof configured === 'string' && /^[0-9]+$/.test(configured)
      ? Number(configured) : configured;
    if (!Number.isSafeInteger(tokens) || tokens < 16 || tokens > 8192)
      throw Object.assign(new Error('Idea output token limit must be an integer from 16 to 8192'), { code: 'CONFIG_ERROR' });
    options.maxTokens = tokens;
  }
  if (['deepseek', 'openai'].includes(env.PI_PROVIDER ?? 'deepseek')) return createIdeaRuntime({ env, ...options });
  const models = builtinModels();
  const model = models.getModel(env.PI_PROVIDER, env.PI_MODEL);
  if (!model) throw Object.assign(new Error('Configure PI_PROVIDER / PI_MODEL or DeepSeek'), { code: 'CONFIG_ERROR' });
  const outputTokens = ideaOperation ? Math.min(options.maxTokens, model.maxTokens) : 4096;
  return { model, streamFn: (m, context, options) => models.streamSimple(m, context,
    { ...options, maxTokens: outputTokens, maxRetries: 0 }) };
}
