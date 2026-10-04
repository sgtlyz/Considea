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
  if (process.env.CONSIDEA_TRACE_MODEL === '1') runtime.onDiagnostic = record => store.write('last-model-diagnostic', record);
}
const workflow = new InterviewSession({ store, runtimeFor: op => {
  if (live) {
    const budget = store.read('model-budget') ?? { calls: 0, reserved_micros: 0 };
    if (budget.calls >= Number(process.env.CONSIDEA_MAX_MODEL_CALLS) ||
        budget.reserved_micros + 25_000 > Math.floor(Number(process.env.CONSIDEA_MAX_USD) * 1_000_000)) {
      throw Object.assign(new Error('Model budget exhausted'), { code: 'MODEL_BUDGET_EXHAUSTED' });
    }
  }
  return runtime ?? createProtocolFixtureRuntime(op);
},
  maxBatches: process.env.CONSIDEA_MAX_BATCHES === undefined ? undefined : Number(process.env.CONSIDEA_MAX_BATCHES) });
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  let result;
  try { result = await workflow.handle(JSON.parse(line)); }
  catch { result = { ok: false, text: '请求或存储操作失败，未生成可交接结果。', end_session: false }; }
  if (!live) result.text = `OFFLINE MOCK — 非真实模型输出\n${result.text}`;
  console.log(JSON.stringify(result));
}
