import { createModels, fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { runAgent } from './base.mjs';
import definition from './example-role.mjs';

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses([fauxAssistantMessage(JSON.stringify({ status: 'needs_input', warnings: ['Offline fixture; no real model called'], data: {
  member_id: 'member-a', mode: 'initial', round_index: 1,
  questions: [{ question_id: 'q1', text: '最近一次想做项目却没定下来，发生了什么？', purpose: '了解真实经历' }],
  coverage: { pain: 'unknown' }, ready_to_summarize: false, stop_reason: null,
} }))]);
console.log(JSON.stringify(await runAgent({
  request: { schema_version: '1.0', request_id: 'demo-1', room_id: 'demo-room', operation: 'interview.turn', input_revision: 0,
    payload: { member_id: 'member-a', mode: 'initial', round_index: 1, messages: [] } },
  definition, model: faux.getModel(), streamFn: models.streamSimple.bind(models),
}), null, 2));
