import { error } from './contracts.mjs';
import { createModelRuntime } from './models.mjs';
import { createTavilyApi, createTavilyCli } from './retrieval.mjs';

export function createDeployment(env = process.env) {
  const runtime = createModelRuntime(env);
  const transport = env.EVALUATOR_RETRIEVAL ?? 'cli';
  if (!['cli', 'api'].includes(transport)) throw error('CONFIG_ERROR', 'EVALUATOR_RETRIEVAL must be cli or api');
  const retrieval = transport === 'api' ? createTavilyApi({ apiKey: env.TAVILY_API_KEY }) :
    createTavilyCli({ executable: env.TVLY_PATH || 'tvly', pythonExecutable: env.TVLY_PYTHON });
  const officialDomains = (env.EVALUATOR_OFFICIAL_DOMAINS ??
    'spacetimedb.com,fetch.ai,agentverse.ai,api-docs.deepseek.com,ai.google.dev,docs.tavily.com')
    .split(',').map(v => v.trim()).filter(Boolean);
  return { ...runtime, retrieval, officialDomains };
}
