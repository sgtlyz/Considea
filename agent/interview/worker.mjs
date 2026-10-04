import { createInterface } from 'node:readline';
import { runInterview, runLegacyInterview, errorResponse } from './service.mjs';
import { createInterviewFixtureRuntime } from './fixtures.mjs';
import { createProtocolFixtureRuntime } from './protocol-fixtures.mjs';

const legacy = process.argv.includes('--legacy');

let liveRuntime;
if (process.argv.includes('--live')) {
  const { createBoundedLiveRuntime } = await import('./live-runtime.mjs');
  liveRuntime = createBoundedLiveRuntime();
}
// Trusted local JSONL adapter, not an authenticated network service.
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  let request;
  try { request = JSON.parse(line); }
  catch { console.log(JSON.stringify(errorResponse(null, 'INVALID_INPUT', 'Expected a JSON request'))); continue; }
  const response = await (legacy ? runLegacyInterview : runInterview)({ request,
    runtime: liveRuntime ?? (legacy ? createInterviewFixtureRuntime : createProtocolFixtureRuntime)(request?.operation) });
  console.log(JSON.stringify(response));
}
