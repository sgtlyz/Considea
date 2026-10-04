import { readFileSync } from 'node:fs';
import { runOffline } from './offline.mjs';
const request = JSON.parse(readFileSync(new URL('./examples/evaluate.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2).filter(v => v !== '--');
if (args.some(v => v !== '--json')) {
  console.error('Usage: node demo.mjs [--json]'); process.exitCode = 2;
} else {
  const result = await runOffline(request);
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    const data = result.data, label = { pass: '通过', fail: '不通过', insufficient_evidence: '证据不足' };
    console.log('Evaluator 离线演示（模型和检索均为模拟数据）');
    console.log(`候选：${request.payload.idea?.title ?? request.payload.candidate?.title}`);
    console.log(`执行状态：${result.status}${result.error ? ` — ${result.error.message}` : ''}`);
    for (const [key, name] of [['novelty', '查重'], ['feasibility', '可行性']]) {
      const check = data.tests?.[key];
      if (check) console.log(`${name}：${label[check.result]}\n  ${check.reason}`);
    }
    for (const q of data.questions ?? []) console.log(`需要回答：${q.text}`);
    console.log('这个结果只能验证接口接线，不能用于判断真实 idea。');
    console.log('完整 JSON：pnpm demo --json');
  }
  if (result.status === 'error') process.exitCode = 1;
}
