import { createInterface } from 'node:readline';
import { runInterview } from '../../agent/interview/service.mjs';
import { runIdea } from '../../agent/idea/service.mjs';
import { runNegotiator } from '../../agent/negotiate/service.mjs';
import { createOfflineRuntime } from '../../agent/pi-base/offline.mjs';
import { liveRuntime } from '../../agent/pi-base/integration-runtime.mjs';

// stdout is a private JSONL protocol. SDK diagnostics must not corrupt it.
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
console.log = () => {};
console.warn = () => {};
console.error = () => {};
let space;
if (process.env.CONCLAVE_SPACETIME_CONFIG) {
  const { SpaceClient } = await import('./spacetime.mjs');
  space = new SpaceClient(process.env.CONCLAVE_SPACETIME_CONFIG,
    snapshot => send({ event: 'board', room_id: snapshot.room_id, revision: snapshot.revision }));
}
async function handle(message) {
  const { id, action, request, offline_response, attempt } = message;
  try {
    const env = { ...process.env, ...(message.credentials ?? {}) };
    if (action === 'translate') {
      const { translate } = await import('./localize.mjs');
      return send({ id, result: await translate(message, {env}) });
    }
    if (action === 'connect') { await space.open(); return send({ id, result: { connected: true } }); }
    if (action === 'publish') {
      if (!space) throw Object.assign(new Error(), { code: 'SPACETIME_CONFIG_ERROR' });
      return send({ id, result: await space.publish(message) });
    }
    if (action === 'evaluate') {
      const { runWorkflowEvaluation } = await import('../../agent/evaluator/workflow.mjs');
      return send({ id, result: await runWorkflowEvaluation(message, {env}) });
    }
    const runtime = offline_response
      ? createOfflineRuntime(() => ({ status: offline_response.status, data: offline_response.data,
          warnings: ['OFFLINE INTEGRATION: real agent code, simulated model output'] })) : liveRuntime({env});
    let result;
    if (request.operation.startsWith('interview.')) result = await runInterview({ request, runtime });
    else if (request.operation === 'negotiate.detect') result = await runNegotiator({ request, runtime });
    else if (request.operation.startsWith('idea.')) result = space
      ? await space.idea({ request, attempt, runtime }) : await runIdea({ request, runtime });
    else throw Object.assign(new Error(), { code: 'INVALID_OPERATION' });
    send({ id, result });
  } catch (error) {
    // Never forward raw SDK/provider errors, tokens or prompt contents.
    const allowed = ['CONFIG_ERROR','SPACETIME_CONFIG_ERROR','SPACETIME_TIMEOUT','SPACETIME_DISCONNECTED','SPACETIME_CONNECT_FAILED','SPACETIME_SUBSCRIPTION_FAILED'];
    send({ id, error: allowed.includes(error.code) ? error.code : 'INTEGRATION_ERROR' });
  }
}
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (line.trim()) { try { void handle(JSON.parse(line)); } catch { send({ id: null, error: 'INVALID_JSON' }); } }
}
space?.close();
