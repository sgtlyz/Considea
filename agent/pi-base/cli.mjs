import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { runAgent } from './base.mjs';

// JSON lines on stdin/stdout. Module paths are trusted deployment configuration only.
const { default: definition } = await import(process.env.AGENT_MODULE
  ? pathToFileURL(resolve(process.env.AGENT_MODULE)).href : './example-role.mjs');
const models = builtinModels();
const model = models.getModel(process.env.PI_PROVIDER ?? 'openai', process.env.PI_MODEL ?? 'gpt-4o-mini');
if (!model) throw new Error('Unknown PI_PROVIDER / PI_MODEL');
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  let request;
  try { request = JSON.parse(line); } catch { request = null; }
  console.log(JSON.stringify(await runAgent({ request, definition, model,
    streamFn: (m, context, options) => models.streamSimple(m, context, { ...options, maxTokens: 4096 }),
  })));
}
