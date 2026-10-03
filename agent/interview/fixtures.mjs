import { createOfflineRuntime } from '../pi-base/offline.mjs';
import { emptyCoverage, topics } from './service.mjs';

export const sampleRoom = { room_id: 'demo-room', member_ids: ['a', 'b', 'c', 'd'],
  initial_interview_max_rounds: 7, max_questions_per_turn: 3,
  max_iterations: 3, followup_batches_per_member_per_iteration: 1, constraints: [] };

export const samplePayload = (member_id = 'a') => ({ room_config: structuredClone(sampleRoom),
  private_interview: { member_id, mode: 'initial', round_index: 0, messages: [], coverage: emptyCoverage() },
  shared_context: null, followup_task: null });

export function fixtureReply(p) {
  const s = p.private_interview;
  const answers = s.messages.filter(m => m.role === 'user').map(m => m.content);
  let data;
  // The local runner supplies this field only to the fixture, never the live prompt.
  if (p.fixture_operation === 'interview.summarize') {
    data = { member_id: s.member_id, draft_profile: { member_id: s.member_id,
      items: [...(p.profile?.items ?? []), ...answers.map((text, i) => ({ item_id: `draft-${i + 1}`,
        category: s.mode === 'followup' ? 'participation_condition' : i ? 'preference' : 'pain',
        text, basis: 'member_statement' }))], unknowns: p.profile?.unknowns ?? ['skill', 'resource'] },
      changes: ['离线样例直接保留回答，分类仅用于演示'], unknowns: ['skill', 'resource'] };
  } else {
    const coverage = { ...emptyCoverage(), ...s.coverage };
    const ready = answers.length >= 2;
    const initialQuestions = s.round_index === 0
      ? ['最近一次讨论项目却没定下来，发生了什么？', '当时你想保留什么体验？', '你现在怎么处理这个问题？']
      : ['你有哪些能直接复用的技术或资源？', '什么方向让你不想参与？', '改变什么条件，你会更愿意参与？'];
    const texts = s.mode === 'followup'
      ? [`关于“${p.followup_task.goal}”，你最在意什么？`, '哪些条件可以接受，哪些暂时不想解释？']
      : initialQuestions;
    data = { member_id: s.member_id, mode: s.mode,
      round_index: ready ? s.round_index : s.round_index + 1,
      questions: ready ? [] : texts.slice(0, p.room_config.max_questions_per_turn).map((text, i) => ({
        question_id: `fixture-${i + 1}`, text, purpose: '离线流程示例' })),
      coverage, ready_to_summarize: ready, stop_reason: ready ? 'enough_information' : null };
  }
  return { status: 'ok', data, warnings: ['OFFLINE FIXTURE：固定样例，不代表 DeepSeek 访谈质量'] };
}

export function createInterviewFixtureRuntime(operation) {
  return createOfflineRuntime(p => fixtureReply({ ...p, fixture_operation: operation }));
}
