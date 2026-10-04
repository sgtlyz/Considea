import { createInterface } from 'node:readline';
import { normalizeRequest, error } from './contracts.mjs';
import { runEvaluator, errorResponse, requiredInputResponse } from './runner.mjs';
import { createDeployment } from './deployment.mjs';
export { createDeployment } from './deployment.mjs';
import { runOffline } from './offline.mjs';


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
      const normalized = normalizeRequest(request); // Validate and ask for missing context before deployment credentials.
      result = requiredInputResponse(normalized);
      if (!result) {
        if (fixture) result = await runOffline(normalized);
        else { deployment ??= createDeployment(); result = await runEvaluator({ request: normalized, ...deployment }); }
      }
    } catch (e) {
      result = errorResponse(request, ['INVALID_INPUT', 'CONFIG_ERROR'].includes(e?.code) ? e.code : 'MODEL_ERROR',
        ['INVALID_INPUT', 'CONFIG_ERROR'].includes(e?.code) ? e.message : 'Evaluator entry failed');
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  }
}
await main();
