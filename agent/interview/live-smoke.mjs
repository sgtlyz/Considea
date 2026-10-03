import { createBoundedLiveRuntime } from './live-runtime.mjs';
import { runInterview } from './service.mjs';
import { samplePayload } from './fixtures.mjs';

if (!process.argv.includes('--live')) throw new Error('Live smoke requires --live');
const runtime = createBoundedLiveRuntime({ maxCalls: 2 });
const payload = samplePayload();
const request = operation => ({ schema_version: '1.0', request_id: `live-smoke-${operation}`, room_id: 'demo-room',
  operation, input_revision: 0, payload });
const turn = await runInterview({ request: request('interview.turn'), runtime });
if (turn.status !== 'ok' && turn.status !== 'needs_input') throw new Error(`Turn failed: ${turn.error?.code ?? turn.status}`);
if (!turn.data.questions.length) throw new Error('Expected first interview questions');
payload.private_interview.messages = [
  { role: 'assistant', content: turn.data.questions.map(q => q.text).join('\n') },
  { role: 'user', content: '我喜欢狼人杀和多人互动，想做贴近日常生活的项目。我会一些前端，后端不熟。其他队友的想法我不知道。' },
];
payload.private_interview.round_index = 1;
const summary = await runInterview({ request: request('interview.summarize'), runtime });
if (summary.status !== 'ok') throw new Error(`Summary failed: ${summary.error?.code ?? summary.status}`);
console.log(JSON.stringify({ live: true, calls: runtime.calls, model: runtime.model.id,
  questions: turn.data.questions, draft_profile: summary.data.draft_profile,
  note: '仅验证两次真实模型调用和契约；未验证多人部署、持久化或整体访谈质量。' }, null, 2));
