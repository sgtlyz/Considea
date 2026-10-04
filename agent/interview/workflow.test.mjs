import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineRuntime } from '../pi-base/offline.mjs';
import { InterviewWorkflow, WorkflowError } from './workflow.mjs';
import { runLegacyInterview as runInterview, emptyCoverage } from './service.mjs';
import { createInterviewFixtureRuntime, sampleRoom, samplePayload } from './fixtures.mjs';

const room = () => structuredClone(sampleRoom);
const fixtureWorkflow = () => new InterviewWorkflow({ runtimeFor: createInterviewFixtureRuntime });
const createSession = (workflow, member_id = 'a', extra = {}) => workflow.createSession({
  room_config: room(), member_id, ...extra,
});
const revision = (workflow, id) => workflow.getPrivate(id).revision;
const next = (workflow, id) => workflow.next(id, { expectedRevision: revision(workflow, id) });
const answer = (workflow, id, text) => workflow.answer(id, {
  expectedRevision: revision(workflow, id), text,
});
const summarize = (workflow, id) => workflow.summarize(id, { expectedRevision: revision(workflow, id) });
const request = (operation, payload = samplePayload()) => ({
  schema_version: '1.0', request_id: 'offline-test', room_id: payload.room_config.room_id,
  operation, input_revision: 0, payload,
});
const questionsReply = payload => ({
  status: 'ok', warnings: [], data: {
    member_id: payload.private_interview.member_id, mode: payload.private_interview.mode,
    round_index: payload.private_interview.round_index + 1,
    questions: [{ question_id: 'draft-question', text: 'What would you like to share?', purpose: 'Understand your preference' }],
    coverage: emptyCoverage(), ready_to_summarize: false, stop_reason: null,
  },
});
const assertWorkflowError = (action, code) => assert.throws(action,
  error => error instanceof WorkflowError && error.code === code);

test('first question batch is round 1 while answered rounds stay at 0', async () => {
  const workflow = fixtureWorkflow();
  const s = createSession(workflow);
  const result = await next(workflow, s.session_id);
  assert.equal(result.response.status, 'ok');
  assert.equal(result.response.data.round_index, 1);
  assert.equal(result.session.payload.private_interview.round_index, 0);
  assert.equal(result.session.questions.length, 3);
  assert.equal(result.session.status, 'awaiting_answer');
  assert.equal(workflow.getProgress(s.session_id).answered_rounds, 0);
  const answered = answer(workflow, s.session_id, 'A concrete experience');
  assert.equal(answered.payload.private_interview.round_index, 1);
  assert.equal(answered.status, 'ready');
});

test('seventh question batch is allowed and deterministic cap prevents an eighth model call', async () => {
  let modelCalls = 0;
  const runtime = createOfflineRuntime(payload => { modelCalls++; return questionsReply(payload); });
  const workflow = new InterviewWorkflow({ runtimeFor: () => runtime });
  const s = createSession(workflow);
  for (let batch = 1; batch <= 7; batch++) {
    const result = await next(workflow, s.session_id);
    assert.equal(result.response.status, 'ok', JSON.stringify(result.response));
    assert.equal(result.response.data.round_index, batch);
    assert.equal(result.session.status, 'awaiting_answer');
    assert.equal(result.session.payload.private_interview.round_index, batch - 1);
    answer(workflow, s.session_id, `Answer to batch ${batch}`);
  }
  assert.equal(modelCalls, 7);
  const capped = await next(workflow, s.session_id);
  assert.equal(capped.response.status, 'ok');
  assert.equal(capped.response.data.stop_reason, 'round_limit');
  assert.deepEqual(capped.session.questions, []);
  assert.equal(capped.session.status, 'ready_to_summarize');
  assert.equal(modelCalls, 7);
  assertWorkflowError(() => next(workflow, s.session_id), 'INVALID_STATE');
});

test('service enforces round limit and member finish without any configured model', async () => {
  for (const [round_index, finish_requested, reason] of [
    [7, false, 'round_limit'], [0, true, 'member_requested'],
  ]) {
    const payload = samplePayload();
    Object.assign(payload.private_interview, { round_index, finish_requested,
      messages: Array.from({ length: round_index }, (_, i) => ({ role: 'user', content: `Completed answer ${i + 1}` })),
    });
    const response = await runInterview({ request: request('interview.turn', payload) });
    assert.equal(response.status, 'ok');
    assert.equal(response.data.stop_reason, reason);
    assert.deepEqual(response.data.questions, []);
    assert.equal(response.data.ready_to_summarize, true);
  }
});

test('inconsistent answer counts and unanswered trailing question fail before model use', async () => {
  let modelCalls = 0;
  const runtime = { model: {}, streamFn: () => { modelCalls++; throw new Error('must not call'); } };
  for (const [round_index, messages] of [
    [7, []],
    [0, [{ role: 'user', content: 'An answer cannot be hidden by resetting the counter.' }]],
    [1, [{ role: 'user', content: '   ' }]],
    [0, [{ role: 'assistant', content: 'Still awaiting your first answer.' }]],
  ]) {
    for (const operation of ['interview.turn', 'interview.summarize']) {
      const payload = samplePayload();
      Object.assign(payload.private_interview, { round_index, messages });
      const response = await runInterview({ request: request(operation, payload), runtime });
      assert.equal(response.status, 'error');
      assert.equal(response.error.code, 'INVALID_INPUT');
    }
  }
  assert.equal(modelCalls, 0);
});

test('raw answers and unapproved summary stay out of shared profile and public progress', async () => {
  const workflow = fixtureWorkflow();
  const s = createSession(workflow);
  const secret = 'PRIVATE: I feel discouraged about the team discussion.';
  await next(workflow, s.session_id);
  answer(workflow, s.session_id, secret);
  const result = await summarize(workflow, s.session_id);
  assert.equal(result.response.status, 'ok');
  assert.equal(result.session.status, 'awaiting_approval');
  assert.ok(JSON.stringify(result.session.draft).includes(secret));
  assert.equal(workflow.getShared(s.session_id), null);
  assert.ok(!JSON.stringify(workflow.getProgress(s.session_id)).includes(secret));
  assert.deepEqual(Object.keys(workflow.getProgress(s.session_id)).sort(),
    ['answered_rounds', 'revision', 'session_id', 'status']);
});

test('approval publishes only edited draft and creates workflow-owned approval metadata', async () => {
  const workflow = fixtureWorkflow();
  const s = createSession(workflow);
  await next(workflow, s.session_id);
  answer(workflow, s.session_id, 'PUBLIC: I want a practical demo.');
  await next(workflow, s.session_id);
  answer(workflow, s.session_id, 'PRIVATE: Remove this line before sharing.');
  const result = await summarize(workflow, s.session_id);
  const draft = structuredClone(result.session.draft);
  draft.items = draft.items.filter(item => !item.text.startsWith('PRIVATE:'));
  const shared = workflow.approve(s.session_id, { expectedRevision: result.session.revision, draft });
  assert.equal(shared.items.length, 1);
  assert.equal(shared.items[0].text, 'PUBLIC: I want a practical demo.');
  assert.equal(shared.member_id, 'a');
  assert.equal(shared.version, 1);
  assert.ok(shared.profile_id);
  assert.ok(!Number.isNaN(Date.parse(shared.approved_at)));
  assert.ok(!JSON.stringify(workflow.getShared(s.session_id)).includes('PRIVATE:'));
  assert.ok(JSON.stringify(workflow.getPrivate(s.session_id).payload.private_interview.messages).includes('PRIVATE:'));
  assert.ok(!JSON.stringify(workflow.getProgress(s.session_id)).includes('PUBLIC:'));
});

test('stale or duplicate answers do not increment the answered round twice', async () => {
  const workflow = fixtureWorkflow();
  const s = createSession(workflow);
  const result = await next(workflow, s.session_id);
  const expectedRevision = result.session.revision;
  workflow.answer(s.session_id, { expectedRevision, text: 'First submitted answer' });
  assertWorkflowError(() => workflow.answer(s.session_id, { expectedRevision, text: 'Duplicate answer' }), 'STALE_REVISION');
  assertWorkflowError(() => answer(workflow, s.session_id, 'Duplicate with fresh version'), 'INVALID_STATE');
  const stored = workflow.getPrivate(s.session_id);
  assert.equal(stored.payload.private_interview.round_index, 1);
  assert.deepEqual(stored.payload.private_interview.messages.filter(message => message.role === 'user')
    .map(message => message.content), ['First submitted answer']);
});

test('followup has one question batch and cannot continue into a second model call', async () => {
  let modelCalls = 0;
  const runtime = createOfflineRuntime(payload => { modelCalls++; return questionsReply(payload); });
  const workflow = new InterviewWorkflow({ runtimeFor: () => runtime });
  const s = createSession(workflow, 'a', { mode: 'followup',
    followup_task: { goal: 'Clarify acceptable delay', expected_information: ['Acceptable delay'], issue_id: 'issue-1' } });
  const first = await next(workflow, s.session_id);
  assert.equal(first.response.status, 'ok', JSON.stringify(first.response));
  assert.equal(first.response.data.mode, 'followup');
  answer(workflow, s.session_id, 'Up to two seconds would work.');
  const capped = await next(workflow, s.session_id);
  assert.equal(capped.response.data.stop_reason, 'round_limit');
  assert.equal(capped.session.status, 'ready_to_summarize');
  assert.equal(modelCalls, 1);
});

test('approved followup creates version 2 retaining prior facts and the new participation condition', async () => {
  const workflow = fixtureWorkflow();
  const initial = createSession(workflow);
  await next(workflow, initial.session_id);
  answer(workflow, initial.session_id, 'I build browser interfaces and enjoy interactive games.');
  const firstSummary = await summarize(workflow, initial.session_id);
  const firstProfile = workflow.approve(initial.session_id, {
    expectedRevision: firstSummary.session.revision, draft: firstSummary.session.draft,
  });
  const followup = createSession(workflow, 'a', {
    mode: 'followup', profile: firstProfile,
    followup_task: { goal: 'Clarify acceptable scope', expected_information: ['Participation condition'], issue_id: 'issue-2' },
  });
  await next(workflow, followup.session_id);
  answer(workflow, followup.session_id, 'I can participate if the first demo uses text instead of voice.');
  const updatedSummary = await summarize(workflow, followup.session_id);
  assert.equal(updatedSummary.response.status, 'ok', JSON.stringify(updatedSummary.response));
  assert.equal(updatedSummary.session.status, 'awaiting_approval');
  assert.deepEqual(workflow.getShared(followup.session_id), firstProfile);
  const secondProfile = workflow.approve(followup.session_id, {
    expectedRevision: updatedSummary.session.revision, draft: updatedSummary.session.draft,
  });
  assert.equal(secondProfile.profile_id, firstProfile.profile_id);
  assert.equal(secondProfile.version, 2);
  assert.equal(secondProfile.items.length, 2);
  assert.ok(secondProfile.items.some(item => item.text === firstProfile.items[0].text));
  assert.ok(secondProfile.items.some(item => item.category === 'participation_condition' &&
    item.text === 'I can participate if the first demo uses text instead of voice.'));
  assert.deepEqual(workflow.getShared(initial.session_id), firstProfile);
  assert.equal(firstProfile.version, 1);
  assert.equal(firstProfile.items.length, 1);
});

test('summary with no member answer requests input without model use or shared output', async () => {
  let modelCalls = 0;
  const runtime = { model: {}, streamFn: () => { modelCalls++; throw new Error('must not call'); } };
  const workflow = new InterviewWorkflow({ runtimeFor: () => runtime });
  const s = createSession(workflow);
  const result = await summarize(workflow, s.session_id);
  assert.equal(result.response.status, 'needs_input');
  assert.equal(modelCalls, 0);
  assert.equal(workflow.getShared(s.session_id), null);
  assert.equal(result.session.draft, null);
  assert.notEqual(result.session.status, 'awaiting_approval');
  assert.deepEqual(result.response.data.draft_profile.items, []);
});

test('provider errors preserve session state and do not leak provider exception text', async () => {
  const secret = 'PROVIDER_PRIVATE_PAYLOAD';
  const runtime = { model: {}, streamFn: () => { throw new Error(secret); } };
  const workflow = new InterviewWorkflow({ runtimeFor: () => runtime });
  const s = createSession(workflow);
  const before = workflow.getPrivate(s.session_id);
  const result = await next(workflow, s.session_id);
  assert.equal(result.response.status, 'error');
  assert.equal(result.response.error.code, 'MODEL_ERROR');
  assert.ok(!JSON.stringify(result.response).includes(secret));
  assert.deepEqual(workflow.getPrivate(s.session_id), before);
  assert.equal(workflow.getProgress(s.session_id).status, 'ready');
});

test('shared runtime keeps private contexts isolated across sequential and concurrent sessions', async () => {
  const contexts = [];
  const runtime = createOfflineRuntime(async (payload, context) => {
    contexts.push({ member: payload.private_interview.member_id, text: JSON.stringify(context) });
    await new Promise(resolve => setTimeout(resolve, payload.private_interview.member_id === 'a' ? 10 : 1));
    return questionsReply(payload);
  });
  const workflow = new InterviewWorkflow({ runtimeFor: () => runtime });
  const a = createSession(workflow, 'a');
  const b = createSession(workflow, 'b');
  await next(workflow, a.session_id);
  answer(workflow, a.session_id, 'PRIVATE_MEMBER_A_SECRET');
  await next(workflow, b.session_id);
  answer(workflow, b.session_id, 'PRIVATE_MEMBER_B_SECRET');
  const results = await Promise.all([next(workflow, a.session_id), next(workflow, b.session_id)]);
  assert.deepEqual(results.map(result => result.response.status), ['ok', 'ok']);
  assert.deepEqual(results.map(result => result.response.data.member_id), ['a', 'b']);
  assert.equal(contexts.length, 4);
  for (const { member, text } of contexts) {
    assert.ok(!text.includes(member === 'a' ? 'PRIVATE_MEMBER_B_SECRET' : 'PRIVATE_MEMBER_A_SECRET'));
  }
  assert.ok(contexts.some(entry => entry.member === 'a' && entry.text.includes('PRIVATE_MEMBER_A_SECRET')));
  assert.ok(contexts.some(entry => entry.member === 'b' && entry.text.includes('PRIVATE_MEMBER_B_SECRET')));
});

test('in-flight request prevents double submission and status contains no model content', async () => {
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const runtime = createOfflineRuntime(async payload => {
    started();
    await gate;
    return questionsReply(payload);
  });
  const workflow = new InterviewWorkflow({ runtimeFor: () => runtime });
  const s = createSession(workflow);
  const pending = next(workflow, s.session_id);
  await ready;
  try {
    assert.equal(workflow.getProgress(s.session_id).status, 'running');
    assertWorkflowError(() => next(workflow, s.session_id), 'BUSY');
    assertWorkflowError(() => workflow.finish(s.session_id, { expectedRevision: s.revision }), 'BUSY');
  } finally {
    release();
  }
  const result = await pending;
  assert.equal(result.response.status, 'ok');
  assert.equal(result.session.revision, 1);
});

test('returned snapshots cannot mutate stored session or approved shared content', async () => {
  const workflow = fixtureWorkflow();
  const s = createSession(workflow);
  s.payload.private_interview.member_id = 'b';
  s.payload.room_config.member_ids.push('intruder');
  assert.equal(workflow.getPrivate(s.session_id).payload.private_interview.member_id, 'a');
  assert.equal(workflow.getPrivate(s.session_id).payload.room_config.member_ids.length, 4);
  await next(workflow, s.session_id);
  answer(workflow, s.session_id, 'Approved content');
  const result = await summarize(workflow, s.session_id);
  const shared = workflow.approve(s.session_id, { expectedRevision: result.session.revision, draft: result.session.draft });
  shared.items[0].text = 'Tampered outside workflow';
  assert.equal(workflow.getShared(s.session_id).items[0].text, 'Approved content');
});
