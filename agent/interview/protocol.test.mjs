import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import definition, { validatePayload, validateTurnOutput, validateSummaryOutput } from './definition.mjs';
import { runInterview } from './service.mjs';
import { createOfflineRuntime } from '../pi-base/offline.mjs';

const pair = name => JSON.parse(readFileSync(new URL(`./examples/${name}.json`, import.meta.url), 'utf8'));
const followup = () => pair('difference-followup-v2.1');
const reopened = () => pair('evaluation-reopened-v2.1');
const stub = response => createOfflineRuntime(() => ({ status: response.status, data: response.data, warnings: ['OFFLINE TEST'] }));

test('upstream 2.0 initial/followup/summary and both 2.1 paired examples use the real Pi path', async () => {
  for (const name of ['interview-turn-v2', 'interview-ready-v2', 'interview-followup-v2', 'interview-summary-v2',
    'difference-followup-v2.1', 'evaluation-reopened-v2.1']) {
    const x = pair(name), spec = definition.operations[x.request.operation];
    assert.equal(spec.validateInput(x.request.payload), true, name);
    assert.equal(spec.validateOutput(x.response.data, x.request.payload), true, name);
    const result = await runInterview({ request: x.request, runtime: stub(x.response) });
    assert.deepEqual(result.data, x.response.data, `${name}: ${JSON.stringify(result)}`);
    assert.equal(result.status, x.response.status);
  }
});

test('new entry rejects old or unknown contracts rather than bypassing the human gate', async () => {
  for (const version of [undefined, '1.0', '2.2']) {
    const x = followup(); x.request.payload.contract_version = version;
    assert.equal((await runInterview({ request: x.request })).error.code, 'INVALID_INPUT');
  }
  const old = reopened(); old.request.payload.contract_version = '2.0';
  assert.equal(validatePayload(old.request.payload), false);
});

test('difference question, real answers and conclusion survive through model input unchanged', async () => {
  const x = followup(); let seen;
  const runtime = createOfflineRuntime(p => { seen = p; return { status: x.response.status, data: x.response.data, warnings: [] }; });
  assert.equal((await runInterview({ request: x.request, runtime })).status, 'needs_input');
  assert.deepEqual(seen.followup_context, x.request.payload.followup_context);
  assert.notEqual(seen.followup_context.answers[0].selected_option_key, seen.followup_context.answers[1].selected_option_key);
});

test('invalid human difference contexts fail before model use', async () => {
  for (const change of [
    c => { c.answers = []; }, c => { c.answers.push(c.answers[0]); }, c => { c.decision_result = null; },
    c => { c.decision_result.conclusion = ' '; }, c => { c.decision_result.decision = 'converge'; },
    c => { c.answers[0].difference_ref.version++; }, c => { c.answers[0].member_id = 'outsider'; },
    c => { c.answers[0].selected_option_key = 'invented'; }, c => { c.decision_result.source_ids = ['missing']; },
    c => { c.difference.discussion_round = 4; c.decision_result.discussion_round = 4; },
  ]) {
    const x = followup(); change(x.request.payload.followup_context); let calls = 0;
    const result = await runInterview({ request: x.request, runtime: createOfflineRuntime(() => { calls++; throw new Error('must not call'); }) });
    assert.equal(result.error?.code, 'INVALID_INPUT'); assert.equal(calls, 0);
  }
});

test('human diverge after round four requires its explicit referenced decision', () => {
  const p = followup().request.payload, c = p.followup_context;
  p.discussion_round = 5; c.trigger = 'human_diverge'; c.difference.discussion_round = 4;
  Object.assign(c.decision_result, { discussion_round: 4, decision: 'diverge', source_ids: ['human-diverge'] });
  p.shared_context.sources.push({ source_id: 'human-diverge', kind: 'convergence_decision', object_ref: c.decision_result.decision_ref,
    member_id: null, discussion_round: 4, text: 'OFFLINE MOCK: 人工决定继续讨论。' });
  assert.equal(validatePayload(p), true);
  c.decision_result.decision = 'converge'; assert.equal(validatePayload(p), false);
  c.decision_result.decision = 'diverge'; p.shared_context.sources.at(-1).object_ref = { id: 'other', version: 1 };
  assert.equal(validatePayload(p), false);
});

test('reopened receives exact reviewed candidate, findings, partial status, verdict and instructions', async () => {
  for (const verdict of ['feasible', 'infeasible', 'conditional', 'unknown']) {
    const x = reopened(); x.request.payload.followup_context.evaluation.feasibility.verdict = verdict;
    let seen; const runtime = createOfflineRuntime(p => { seen = p; return { status: x.response.status, data: x.response.data, warnings: [] }; });
    assert.equal((await runInterview({ request: x.request, runtime })).status, 'needs_input');
    assert.deepEqual(seen.followup_context, x.request.payload.followup_context);
    assert.equal(seen.followup_context.difference, null); // No fabricated difference needed for review re-entry.
  }
});

test('evaluation cannot trigger interview without more_discussion on matching candidate and report', async () => {
  for (const change of [
    c => { c.review = null; }, c => { c.review.decision = 'accept'; }, c => { c.review.decision = 'minor_revision'; },
    c => { c.review.instructions = ''; }, c => { c.review.member_id = 'outsider'; },
    c => { c.candidate = null; }, c => { c.evaluation = null; },
    c => { c.review.candidate_ref.version++; }, c => { c.review.evaluation_ref.version++; },
    c => { c.evaluation.content.candidate_ref.version++; }, c => { delete c.evaluation.feasibility; },
    c => { c.evaluation.feasibility.verdict = 'complete'; }, c => { c.trigger = 'difference_answers'; },
    c => { c.candidate.content.discussion_source_ids = ['private-unapproved']; },
    c => { c.evaluation.content.findings[0].evidence_keys = ['invented']; },
  ]) {
    const x = reopened(); change(x.request.payload.followup_context); let calls = 0;
    const result = await runInterview({ request: x.request, runtime: createOfflineRuntime(() => { calls++; throw new Error('must not call'); }) });
    assert.equal(result.error?.code, 'INVALID_INPUT'); assert.equal(calls, 0);
  }
});

test('zero private question budget stops without a model call or team convergence decision', async () => {
  const x = reopened(); x.request.payload.limits.remaining_question_batches = 0;
  const r = await runInterview({ request: x.request });
  assert.equal(r.status, 'ok'); assert.equal(r.data.stop_reason, 'question_budget');
  assert.deepEqual(r.data.questions, []); assert.equal(r.data.decision, undefined);
});

test('shared sources, own profile and private message identifiers must resolve consistently', () => {
  for (const change of [
    p => { p.current_profile.member_id = 'member-b'; },
    p => { p.messages.push(p.messages[0]); },
    p => { p.shared_context.sources.push(p.shared_context.sources[0]); },
    p => { p.shared_context.profiles[0].items[0].source_id = 'missing'; },
    p => { p.shared_context.discussion_history[0].answer_source_ids.push('missing'); },
  ]) { const p = followup().request.payload; change(p); assert.equal(validatePayload(p), false); }
});

test('output rejects invented approvals, foreign evidence and invalid question/status combinations', async () => {
  const x = followup(), p = x.request.payload;
  for (const change of [
    d => { d.approved_at = 'today'; }, d => { d.member_id = 'other'; },
    d => { d.questions[0].related_source_ids = ['private-message']; },
    d => { d.questions.push(...structuredClone(d.questions), ...structuredClone(d.questions), ...structuredClone(d.questions)); },
    d => { d.contract_version = '2.0'; },
  ]) { const d = structuredClone(x.response.data); change(d); assert.equal(validateTurnOutput(d, p), false); }
  const runtime = createOfflineRuntime(() => ({ status: 'ok', data: x.response.data, warnings: [] }));
  const normalized = await runInterview({ request: x.request, runtime });
  assert.equal(normalized.status, 'needs_input');
  assert.deepEqual(normalized.data, x.response.data);
  assert.match(normalized.warnings.join(' '), /MODEL_FORMAT_NORMALIZED/);
  const s = pair('interview-summary-v2');
  for (const id of ['other-member-answer', s.request.payload.messages.find(m => m.role === 'assistant').message_id]) {
    const d = structuredClone(s.response.data); d.profile_draft.items[0].private_message_ids = [id];
    assert.equal(validateSummaryOutput(d, s.request.payload), false);
  }
});

test('existing approved facts may survive, but evaluation context alone cannot become a personal claim', () => {
  const p = reopened().request.payload;
  delete p.limits; delete p.interview_turn; p.stop_reason = 'member_requested'; p.messages = [];
  const old = p.current_profile.items[0];
  const d = { contract_version: '2.1', member_id: p.member_id, profile_draft: { items: [{ item_key: 'kept',
    category: old.category, text: old.text, basis: old.basis, confidence: old.confidence, private_message_ids: [] }], unknowns: [] } };
  assert.equal(validateSummaryOutput(d, p), true);
  d.profile_draft.items[0].text = p.followup_context.evaluation.content.summary;
  assert.equal(validateSummaryOutput(d, p), false);
});

test('JSONL worker accepts both new followup routes offline', () => {
  const requests = [followup().request, reopened().request];
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./worker.mjs', import.meta.url))],
    { input: requests.map(x => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const replies = child.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(replies.length, 2);
  replies.forEach((r, i) => { assert.equal(r.status, 'needs_input', JSON.stringify(r)); assert.equal(r.request_id, requests[i].request_id); });
});
