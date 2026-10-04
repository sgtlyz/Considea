import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nativeRequest, projectReport, runWorkflowEvaluation } from '../workflow.mjs';
import { finalizeReport, incompleteDraft } from '../contracts.mjs';
const fixture = JSON.parse(readFileSync(new URL('../../interfaces/fixtures/evaluator-complete.json', import.meta.url))).request;
function input(search = true) {
  const request = structuredClone(fixture); request.payload.provided_evidence = [];
  request.payload.search_policy = { enabled: search, max_queries: search ? 2 : 0 };
  const source = request.payload.shared_sources[0];
  return { request, context: { time_limit: { kind: 'duration', hours: 24 }, resources: [{
    profile_id: source.object_ref.id, profile_version: source.object_ref.version,
    item_id: 'approved-resource', member_id: source.member_id, text: source.text,
    category: 'resource', source_id: source.source_id }] }, offline: true };
}

test('workflow adapter runs real Pi search/read/submit loop and preserves native report', async () => {
  const message = input(), result = await runWorkflowEvaluation(message);
  assert.notEqual(result.response.status, 'error', JSON.stringify(result.response));
  assert.equal(result.report.fixture, true);
  assert.equal(result.report.passed, false);
  assert.equal(result.report.search_log.filter(v => v.executed).length, 2);
  assert.equal(result.report.evidence.length, 2);
  assert.equal(result.response.data.evaluation.candidate_ref.id, fixture.payload.candidate.candidate_ref.id);
  assert.equal(result.response.data.evaluation.evidence[0].source_kind, 'team_claim');
  assert.equal(result.response.data.evaluation.evidence[0].source_id, message.context.resources[0].source_id);
});

test('disabled search executes no retrieval and needs no credentials', async () => {
  const result = await runWorkflowEvaluation(input(false), { env: {} });
  assert.notEqual(result.response.status, 'error');
  assert.deepEqual(result.report.search_log, []);
  assert.equal(result.report.evidence.length, 1);
  assert.equal(result.report.passed, false);
});

test('missing project time is rejected before credentials or model', async () => {
  const message = input(); delete message.context.time_limit; message.offline = false;
  const result = await runWorkflowEvaluation(message, { env: {} });
  assert.equal(result.response.error.code, 'INVALID_INPUT');
  assert.match(result.response.error.message, /time limit/);
});

test('shared resource must match approved source member, version and exact text', () => {
  for (const field of ['member_id', 'profile_version', 'text', 'source_id']) {
    const message = input(); message.context.resources[0][field] = field === 'profile_version' ? 999 : 'FOREIGN';
    assert.throws(() => nativeRequest(message.request, message.context), { code: 'INVALID_INPUT' });
  }
});

test('adapts constraints without promoting acceptance and never expands search budget', () => {
  const message = input(); message.request.payload.room_context.constraints = [{ constraint_id: 'c1', text: 'Proposed API', verification: 'unknown', acceptance: 'proposed' }];
  message.request.payload.search_policy.max_queries = 50;
  const native = nativeRequest(message.request, message.context);
  assert.equal(native.payload.tool_budget.max_searches, 12);
  assert.equal(native.payload.room_config.constraints[0].acceptance, 'proposed');
  assert.equal(native.payload.room_config.constraints[0].verification_status, 'unverified');
  assert.ok(native.payload.candidate.core_flow.includes(message.request.payload.candidate.content.solution));
});

test('public web stays public_web in complete report and is never called official or self-report', () => {
  const message = input(), native = nativeRequest(message.request, message.context), draft = incompleteDraft(native.payload);
  draft.competitors = [{ name: 'Third party comparison', url: 'https://review.example.org/project', overlap: ['Planning'], differences: ['Unverified difference'], maturity: 'unknown', evidence_ids: ['web-1'] }];
  const report = finalizeReport(draft, native.payload, { incomplete: false, search_log: [], evidence: [{
    evidence_id: 'web-1', url: 'https://review.example.org/project', title: 'Third party review',
    accessed_at: '2026-10-04T00:00:00Z', source_kind: 'public_web', excerpt: 'Review of a project', limitation: 'Third party claim' }] });
  const result = projectReport(message.request, message.context, native, { status: 'partial', data: report, warnings: [] });
  assert.equal(result.report.evidence[0].source_kind, 'public_web');
  assert.deepEqual(result.response.data.evaluation.evidence, []);
  assert.deepEqual(result.response.data.evaluation.similar_projects, []);
  assert.ok(result.response.data.evaluation.unknowns.some(v => v.includes('https://review.example.org/project')));
  assert.equal(result.response.status, 'partial');
});

test('foreign candidate and fabricated pass fail closed', async () => {
  const message = input(), result = await runWorkflowEvaluation(message), native = nativeRequest(message.request, message.context);
  for (const patch of [{ candidate_id: 'foreign' }, { passed: true }]) {
    const report = { ...structuredClone(result.report), ...patch };
    assert.throws(() => projectReport(message.request, message.context, native, { status: 'ok', data: report, warnings: [] }));
  }
});

test('disabled budget and no resources yield a valid honest incomplete report', async () => {
  const message = input(false); message.context.resources = [];
  const result = await runWorkflowEvaluation(message);
  assert.notEqual(result.response.status, 'error');
  assert.deepEqual(result.report.evidence, []);
  assert.equal(result.report.tests.feasibility.result, 'insufficient_evidence');
});
