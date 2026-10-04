import { readFile } from 'node:fs/promises';
import { runDemo } from './demo.mjs';
import { runIdea } from './service.mjs';
import { createIdeaRuntime } from './runtime.mjs';
import { createTavilyProvider } from './search.mjs';
import { createMem0Client } from './memory.mjs';

const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
try {
  const allowed = new Set(['--live', '--offline', '--input', '--max-model-requests', '--max-output-tokens', '--revise', '--no-research']);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error('Unknown command option');
    if (['--input', '--max-model-requests', '--max-output-tokens'].includes(args[i])) i++;
  }
  let result;
  if (!args.includes('--live')) {
    if (value('--input')) throw new Error('Offline mode uses explicitly fabricated fixtures; custom inputs require --live');
    result = await runDemo({ research: !args.includes('--no-research'), revise: args.includes('--revise') });
  } else {
    if (args.includes('--offline') || !value('--input') || !value('--max-model-requests') || !value('--max-output-tokens')) {
      throw new Error('Live mode requires --input, --max-model-requests and --max-output-tokens, and cannot use --offline');
    }
    const raw = await readFile(value('--input'), 'utf8');
    if (Buffer.byteLength(raw) > 200_000) throw new Error('Request exceeds input size limit');
    const parsed = JSON.parse(raw);
    const request = parsed.request ?? parsed;
    const runtime = createIdeaRuntime({ maxModelRequests: Number(value('--max-model-requests')), maxTokens: Number(value('--max-output-tokens')) });
    result = await runIdea({ request, runtime,
      searchProvider: process.env.TAVILY_API_KEY ? createTavilyProvider({ apiKey: process.env.TAVILY_API_KEY }) : undefined,
      memoryClient: process.env.MEM0_API_KEY ? createMem0Client({ apiKey: process.env.MEM0_API_KEY }) : undefined });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'error') process.exitCode = 1;
} catch (error) {
  // Never emit arbitrary provider exceptions, URLs with credentials, or full request payloads.
  process.stderr.write(`${error?.code === 'CONFIG_ERROR' ? error.message : 'Idea CLI failed. Check arguments, input JSON and server configuration.'}\n`);
  process.exitCode = 1;
}
