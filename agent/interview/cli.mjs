import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { InterviewWorkflow } from './workflow.mjs';
import { createInterviewFixtureRuntime, sampleRoom } from './fixtures.mjs';

const live = process.argv.includes('--live');
let liveRuntime;
if (live) {
  const { createBoundedLiveRuntime } = await import('./live-runtime.mjs');
  liveRuntime = createBoundedLiveRuntime();
}
const workflow = new InterviewWorkflow({ runtimeFor: operation => liveRuntime ?? createInterviewFixtureRuntime(operation) });
const rl = createInterface({ input, output });
console.log(live ? 'DeepSeek 本地私人访谈（最多 16 次模型调用）' : 'OFFLINE FIXTURE：固定问题样例，不会调用模型或读取 API key。');
console.log('每组可一次回答全部问题；输入 /finish 提前结束，/quit 退出。');
let session = workflow.createSession({ room_config: sampleRoom, member_id: 'a' });
const id = session.session_id;
try {
  while (session.status === 'ready') {
    const result = await workflow.next(id, { expectedRevision: session.revision });
    if (result.response.status === 'error') throw new Error(result.response.error.message);
    session = result.session;
    if (session.status === 'ready_to_summarize') break;
    for (const [i, q] of session.questions.entries()) console.log(`${i + 1}. ${q.text}`);
    const answer = await rl.question('你的回答 > ');
    if (answer.trim() === '/quit') break;
    if (answer.trim() === '/finish') {
      session = workflow.finish(id, { expectedRevision: session.revision });
      break;
    }
    session = workflow.answer(id, { expectedRevision: session.revision, text: answer });
  }
  if (session.status === 'ready_to_summarize') {
    const result = await workflow.summarize(id, { expectedRevision: session.revision });
    if (result.response.status === 'error') throw new Error(result.response.error.message);
    session = result.session;
    if (result.response.status === 'needs_input') {
      console.log('还没有个人回答，没有生成或共享摘要。');
    } else {
      console.log('\n私人摘要草稿：');
      session.draft.items.forEach((item, i) => console.log(`${i + 1}. [${item.category}] ${item.text}`));
      console.log(`未知：${session.draft.unknowns.join('、')}`);
      const removed = await rl.question('删除不想分享的条目序号（逗号分隔；回车保留） > ');
      const indexes = removed.trim() ? removed.split(',').map(x => Number(x.trim())) : [];
      if (indexes.some(i => !Number.isInteger(i) || i < 1 || i > session.draft.items.length)) {
        throw new Error('条目序号无效，摘要未共享');
      }
      const draft = { ...session.draft, items: session.draft.items.filter((_, i) => !indexes.includes(i + 1)) };
      const approved = await rl.question('输入 SHARE 确认导出上述保留内容；回车则不共享 > ');
      if (approved === 'SHARE') {
        console.log(JSON.stringify(workflow.approve(id, { expectedRevision: session.revision, draft }), null, 2));
      } else console.log('未共享摘要。');
    }
  }
} catch (error) {
  console.error(error.code ? `${error.code}: ${error.message}` : '访谈未完成。检查本地配置或离线测试；没有自动共享摘要。');
  process.exitCode = 1;
} finally { rl.close(); }
