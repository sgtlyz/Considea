import { createInterface } from 'node:readline';
import { normalizeRequest, error } from './contracts.mjs';
import { runEvaluator, errorResponse } from './runner.mjs';
import { createModelRuntime } from './models.mjs';
import { createTavilyApi, createTavilyCli } from './retrieval.mjs';
import { runOffline } from './offline.mjs';

export function createDeployment(env = process.env) {
  const runtime = createModelRuntime(env);
  const transport = env.EVALUATOR_RETRIEVAL ?? 'cli';
  if (!['cli', 'api'].includes(transport)) throw error('CONFIG_ERROR', 'EVALUATOR_RETRIEVAL must be cli or api');
  const retrieval = transport === 'api' ? createTavilyApi({ apiKey: env.TAVILY_API_KEY }) :
    createTavilyCli({ executable: env.TVLY_PATH || 'tvly' });
  const officialDomains = (env.EVALUATOR_OFFICIAL_DOMAINS ??
    'spacetimedb.com,fetch.ai,agentverse.ai,api-docs.deepseek.com,ai.google.dev,docs.tavily.com')
    .split(',').map(v => v.trim()).filter(Boolean);
  return { ...runtime, retrieval, officialDomains };
}

async function main() {
  const args = process.argv.slice(2), fixture = args.includes('--fixture');
  if (args.some(v => v !== '--fixture')) { process.stderr.write('Usage: node cli.mjs [--fixture]\n'); process.exitCode = 2; return; }
  let deployment;
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let request, result;
    try {
      if (Buffer.byteLength(line, 'utf8') > 512000) throw error('INVALID_INPUT', 'Request exceeds the 512 KB input limit');
      try { request = JSON.parse(line); } catch { throw error('INVALID_INPUT', 'Expected one JSON request per line'); }
      normalizeRequest(request); // Invalid inputs take precedence over missing deployment credentials.
      if (fixture) result = await runOffline(request);
      else { deployment ??= createDeployment(); result = await runEvaluator({ request, ...deployment }); }
    } catch (e) {
      result = errorResponse(request, ['INVALID_INPUT', 'CONFIG_ERROR'].includes(e?.code) ? e.code : 'MODEL_ERROR',
        ['INVALID_INPUT', 'CONFIG_ERROR'].includes(e?.code) ? e.message : 'Evaluator entry failed');
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  }
}
await main();
