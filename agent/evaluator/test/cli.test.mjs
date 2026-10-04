import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { request } from './fixtures.mjs';
const entry = fileURLToPath(new URL('../cli.mjs', import.meta.url));
function call(lines, args = [], env = {}, nodeArgs = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [...nodeArgs, entry, ...args], { env: { ...process.env, ...env }, windowsHide: true });
    let stdout = '', stderr = ''; p.stdout.on('data', v => stdout += v); p.stderr.on('data', v => stderr += v);
    p.on('error', reject); p.on('close', code => resolve({ code, stdout, stderr })); p.stdin.end(lines.join('\n') + '\n');
  });
}
test('JSONL fixture entry produces exactly one isolated response per request', async () => {
  const r1 = request(), r2 = request('evaluator.investigate'); r2.request_id = 'req-2';
  const out = await call([JSON.stringify(r1), JSON.stringify(r2), 'invalid-json'], ['--fixture']);
  assert.equal(out.code, 0); const lines = out.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 3); assert.equal(lines[0].request_id, 'req-1'); assert.equal(lines[0].status, 'ok');
  assert.equal(lines[0].data.fixture, true); assert.equal(lines[0].data.passed, true);
  assert.equal(lines[1].request_id, 'req-2'); assert.equal(lines[1].data.issue_id, 'issue-1');
  assert.equal(lines[2].error.code, 'INVALID_INPUT');
  assert.ok(lines[0].warnings.some(v => v.includes('fixture')));
});
test('missing model credentials returns structured configuration error', async () => {
  const out = await call([JSON.stringify(request())], [], { DEEPSEEK_API_KEY: '', GEMINI_API_KEY: '', EVALUATOR_PROVIDER: 'deepseek' });
  const result = JSON.parse(out.stdout.trim()); assert.equal(result.error.code, 'CONFIG_ERROR'); assert.equal(result.status, 'error');
});

test('OpenAI JSONL evaluations receive independent request budgets across more than 32 cumulative model calls', async () => {
  const requests = Array.from({ length: 12 }, (_, index) => {
    const r = request('evaluator.investigate'); r.request_id = `req-${index}`;
    return JSON.stringify(r);
  });
  const out = await call(requests, [], { EVALUATOR_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-4.1-mini',
    OPENAI_API_KEY: 'sk-offline-cli-key', TAVILY_API_KEY: 'offline-tavily-key', EVALUATOR_RETRIEVAL: 'api',
    EVALUATOR_OFFICIAL_DOMAINS: 'docs.example.com', EVALUATOR_BASE_URL: '', EVALUATOR_MODEL: 'gpt-4.1-mini' },
  ['--import', new URL('./openai-cli-transport.mjs', import.meta.url).href]);
  assert.equal(out.code, 0, out.stderr);
  const responses = out.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(responses.length, 12);
  for (const [index, response] of responses.entries()) {
    assert.equal(response.request_id, `req-${index}`);
    assert.equal(response.status, 'ok', `request ${index} has a fresh provider budget: ${response.error?.code}`);
    assert.equal(response.data.evidence.length, 2);
  }
});
