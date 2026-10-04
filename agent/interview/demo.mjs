import assert from 'node:assert/strict';
import { InterviewWorkflow } from './workflow.mjs';
import { createInterviewFixtureRuntime, sampleRoom } from './fixtures.mjs';

const workflow = new InterviewWorkflow({ runtimeFor: createInterviewFixtureRuntime });
let session = workflow.createSession({ room_config: sampleRoom, member_id: 'a' });
const id = session.session_id;
for (const answer of ['我们连续提出几个选题都被否定，最后还没定下来。', '我想做有趣的实时交互；这句暂时不想分享。']) {
  const turn = await workflow.next(id, { expectedRevision: session.revision });
  assert.equal(turn.response.status, 'ok');
  session = workflow.answer(id, { expectedRevision: turn.session.revision, text: answer });
}
session = (await workflow.next(id, { expectedRevision: session.revision })).session;
session = (await workflow.summarize(id, { expectedRevision: session.revision })).session;
assert.equal(workflow.getShared(id), null);
const edited = { ...session.draft, items: session.draft.items.slice(0, 1) };
const shared = workflow.approve(id, { expectedRevision: session.revision, draft: edited });
assert.ok(!JSON.stringify(shared).includes('暂时不想分享'));
console.log('OFFLINE FIXTURE：初访 → 私人摘要 → 删除一条 → 本人确认 → 导出共享摘要');
console.log(JSON.stringify(shared, null, 2));
let followup = workflow.createSession({ room_config: sampleRoom, member_id: 'a', mode: 'followup', profile: shared,
  followup_task: { goal: '理解实时交互的参与条件', expected_information: ['可接受的范围'], issue_id: 'issue-1' } });
const followId = followup.session_id;
followup = (await workflow.next(followId, { expectedRevision: followup.revision })).session;
followup = workflow.answer(followId, { expectedRevision: followup.revision, text: '如果先做文字交互，我愿意考虑。' });
followup = (await workflow.next(followId, { expectedRevision: followup.revision })).session;
assert.equal(followup.status, 'ready_to_summarize');
const final = await workflow.summarize(followId, { expectedRevision: followup.revision });
assert.equal(final.session.status, 'awaiting_approval');
assert.deepEqual(workflow.getShared(followId), shared);
const updated = workflow.approve(followId, { expectedRevision: final.session.revision, draft: final.session.draft });
assert.equal(updated.version, 2);
assert.ok(updated.items.some(item => item.text === shared.items[0].text));
assert.ok(updated.items.some(item => item.text === '如果先做文字交互，我愿意考虑。'));
console.log('定向追访经确认后成为第 2 版，保留旧资料并补充新条件；没有替用户改变 stance。');
