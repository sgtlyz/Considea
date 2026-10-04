import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { JsonStore, InterviewSession } from './session.mjs';
import { createProtocolFixtureRuntime } from '../protocol-fixtures.mjs';
import { budgetedFetch } from './budget.mjs';

const live = process.argv.includes('--live');
const defaultDirectory = fileURLToPath(new URL('../../../.interview-local/single-agent', import.meta.url));
const store = new JsonStore(process.env.CONSIDEA_STATE_DIR ?? defaultDirectory);
let runtime;
if (live) {
  const cap = Number(process.env.CONSIDEA_MAX_MODEL_CALLS ?? '0');
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 32) throw new Error('Set an approved finite CONSIDEA_MAX_MODEL_CALLS (1..32)');
  const { createDeepSeekRuntime } = await import('../../pi-base/deepseek.mjs');
  runtime = createDeepSeekRuntime({ fetch: budgetedFetch({ store, maxCalls: cap,
    maxUsd: Number(process.env.CONSIDEA_MAX_USD ?? '0') }) });
}
const workflow = new InterviewSession({ store, runtimeFor: op => runtime ?? createProtocolFixtureRuntime(op),
  maxBatches: Number(process.env.CONSIDEA_MAX_BATCHES ?? '5') });
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  let result;
  try { result = await workflow.handle(JSON.parse(line)); }
  catch { result = { ok: false, text: '请求或存储操作失败，未生成可交接结果。', end_session: false }; }
  if (!live) result.text = `OFFLINE MOCK — 非真实模型输出\n${result.text}`;
  console.log(JSON.stringify(result));
}
