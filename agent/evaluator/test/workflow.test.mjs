import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeRequest, validateDraft } from '../contracts.mjs';
import { runEvaluator } from '../runner.mjs';
import { runOffline } from '../offline.mjs';
import { request, draft, source } from './fixtures.mjs';

export function workflowRequest() {
  const r = request();
  r.payload.candidate = { candidate_id: 'idea-1', version: 2, title: '团队选题协调员',
    target_user: '四人比赛团队', problem: '难以形成共同选题', solution: '访谈、人工决策、生成候选、成员微调、评估',
    discussion_trace: ['decision-1: 团队选择共同方向'], tradeoffs: ['先做文字'],
    mvp: '评估成员微调后的一个候选', member_suggestions: ['去掉语音'], status: 'refined' };
  r.payload.room_config = { room_id: 'room-1', members: ['member-a'], hackathon_context: '团队选题',
    constraints: ['仅使用获准共享的资料'], discussion_round_limit: 4, idea_candidate_limit: 3,
    status: 'evaluating', time_limit: { kind: 'none' } };
  delete r.payload.team_criteria;
  delete r.payload.previous_report;
  return r;
}

test('latest workflow candidate and room need no obsolete interview or iteration fields', () => {
  const n = normalizeRequest(workflowRequest());
  assert.equal(n.payload.candidate.version, 2);
  assert.deepEqual(n.payload.candidate.target_users, ['四人比赛团队']);
  assert.deepEqual(n.payload.candidate.discussion_trace, ['decision-1: 团队选择共同方向']);
  assert.deepEqual(n.payload.room_config.time_limit, { kind: 'none' });
  assert.deepEqual(normalizeRequest(n), n);
});

test('missing project time asks the end user before model or retrieval configuration', async () => {
  const r = workflowRequest(); delete r.payload.room_config.time_limit;
  let calls = 0;
  const out = await runEvaluator({ request: r, retrieval: { search: async () => { calls++; }, read: async () => { calls++; } } });
  assert.equal(out.status, 'needs_input'); assert.equal(out.error, null);
  assert.equal(out.data.version, 2); assert.equal(out.data.passed, undefined);
  assert.equal(out.data.questions[0].field, 'room_config.time_limit');
  assert.match(out.data.questions[0].text, /time limit/);
  assert.equal(calls, 0);
});

test('explicit no limit, duration and deadline are accepted but contradictory or malformed limits are rejected', () => {
  for (const limit of [{ kind: 'none' }, { kind: 'duration', hours: 40 },
    { kind: 'deadline', deadline_at: '2027-01-01T12:00:00Z' }]) {
    const r = workflowRequest(); r.payload.room_config.time_limit = limit;
    assert.deepEqual(normalizeRequest(r).payload.room_config.time_limit, limit);
  }
  for (const limit of [{ kind: 'none', hours: 18 }, { kind: 'duration', hours: 0 },
    { kind: 'duration', hours: '40' }, { kind: 'deadline', deadline_at: '2027-01-01' },
    { kind: 'deadline', deadline_at: '2027-02-30T12:00:00Z' }]) {
    const r = workflowRequest(); r.payload.room_config.time_limit = limit;
    assert.throws(() => normalizeRequest(r), { code: 'INVALID_INPUT' });
  }
  const r = workflowRequest(); r.payload.room_config.deadline_at = '2027-01-01T12:00:00Z';
  assert.throws(() => normalizeRequest(r), { code: 'INVALID_INPUT' });
});

test('non-time constraints do not answer the time question, and old deadlines remain compatible', async () => {
  const r = request(); delete r.payload.room_config.time_limit;
  assert.equal((await runEvaluator({ request: r })).status, 'needs_input');
  r.payload.room_config.deadline_at = '2027-01-01T12:00:00Z';
  assert.deepEqual(normalizeRequest(r).payload.room_config.time_limit,
    { kind: 'deadline', deadline_at: '2027-01-01T12:00:00Z' });
});

test('workflow reports use the current fields and evidence levels, bind versions, and can be passed as history', async () => {
  const r = workflowRequest(), out = await runOffline(r);
  assert.equal(out.status, 'ok'); assert.equal(out.data.passed, true);
  assert.equal(out.data.version, 2); assert.equal(out.data.report_schema_version, '1.2');
  for (const field of ['feasibility', 'similar_projects', 'technical_checks', 'risks', 'unknowns', 'sources'])
    assert.ok(Array.isArray(out.data[field]), field);
  assert.equal(out.data.technical_checks[0].conclusion, 'supported_by_source');
  assert.equal(out.data.technical_checks[0].next_check_status, 'needs_test');
  assert.ok(out.data.sources.some(s => s.conclusion === 'team_claim'));
  assert.ok(!JSON.stringify(out.data.sources).includes('"verified"'));
  const history = structuredClone(out.data);
  r.payload.previous_report = history;
  assert.doesNotThrow(() => normalizeRequest(r));
  r.payload.previous_report.sources[0].messages = ['private'];
  assert.throws(() => normalizeRequest(r), { code: 'INVALID_INPUT' });
});

test('new workflow without supplied dependencies must discover checks before passing feasibility', () => {
  const p = normalizeRequest(workflowRequest()).payload, d = draft(); d.candidate_version = 2;
  const ledger = { evidence: [source], search_log: [
    { query: 'site:github.com team planning', scope: 'github', executed: true, result_status: 'results',
      result_count: 1, excluded_count: 0, result_urls: ['https://github.com/fixture/team-planner'] },
    { query: 'site:devpost.com/software team planning', scope: 'devpost', executed: true, result_status: 'no_results',
      result_count: 0, excluded_count: 0, result_urls: [] },
  ], incomplete: false };
  assert.equal(validateDraft(d, p, ledger), true);
  d.technical_checks = [];
  assert.equal(validateDraft(d, p, ledger), false);
  d.technical_checks = [{ dependency_id: 'inferred-api', finding: '未知访问条件', conclusion: 'unknown',
    evidence_ids: [], next_check: '核查账号权限' }];
  assert.equal(validateDraft(d, p, ledger), false);
});

test('latest candidate shared trace and suggestions reject nested private data', () => {
  for (const field of ['discussion_trace', 'member_suggestions']) {
    const r = workflowRequest(); r.payload.candidate[field] = [{ messages: ['private'] }];
    assert.throws(() => normalizeRequest(r), { code: 'INVALID_INPUT' });
  }
});

test('CLI asks the time question without credentials; demo defaults to a readable fixture summary and supports JSON', () => {
  const r = workflowRequest(); delete r.payload.room_config.time_limit;
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../cli.mjs', import.meta.url))],
    { input: JSON.stringify(r) + '\n', encoding: 'utf8', env: { ...process.env, DEEPSEEK_API_KEY: '', GEMINI_API_KEY: '' } });
  assert.equal(cli.status, 0); assert.equal(JSON.parse(cli.stdout).status, 'needs_input');
  const entry = fileURLToPath(new URL('../demo.mjs', import.meta.url));
  const demo = spawnSync(process.execPath, [entry], { encoding: 'utf8' });
  assert.equal(demo.status, 0); assert.match(demo.stdout, /离线演示/); assert.match(demo.stdout, /查重/);
  assert.match(demo.stdout, /不能.*真实/); assert.ok(!demo.stdout.includes('"schema_version"'));
  const json = spawnSync(process.execPath, [entry, '--json'], { encoding: 'utf8' });
  assert.equal(json.status, 0); assert.equal(JSON.parse(json.stdout).data.fixture, true);
});
