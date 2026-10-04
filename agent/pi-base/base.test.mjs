import test from 'node:test';
import assert from 'node:assert/strict';
import { createModels, Type, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { runAgent } from './base.mjs';
import { defineRole } from './roles.mjs';
import example from './example-role.mjs';

const request = (member = 'a') => ({ schema_version: '1.0', request_id: `req-${member}`, room_id: 'room-1',
  operation: 'interview.turn', input_revision: 1, payload: { member_id: member } });
const definition = defineRole('interview', { 'interview.turn': {
  validateInput: p => typeof p.member_id === 'string', validateOutput: d => typeof d.answer === 'string',
} });
const output = answer => JSON.stringify({ status: 'ok', data: { answer }, warnings: [] });
function fixture(responses) {
  const faux = fauxProvider();
  const models = createModels(); models.setProvider(faux.provider); faux.setResponses(responses);
  return { model: faux.getModel(), streamFn: models.streamSimple.bind(models) };
}
test('preserves workflow headers and validates model output', async () => {
  const r = await runAgent({ request: request(), definition, ...fixture([fauxAssistantMessage(output('hello'))]) });
  assert.equal(r.request_id, 'req-a'); assert.equal(r.input_revision, 1);
  assert.equal(r.status, 'ok'); assert.equal(r.data.answer, 'hello');
});

test('validated tool output ends at the turn boundary and preserves the normal envelope', async () => {
  let submitted;
  const def = { ...definition, operations: { 'interview.turn': { ...definition.operations['interview.turn'],
    getOutput: () => submitted } }, createTools: () => [{ name: 'submit', label: 'Submit', description: 'Submit fixture output',
    parameters: Type.Object({}), execute: async () => {
      submitted = { status: 'ok', data: { answer: 'submitted' }, warnings: [] };
      return { content: [{ type: 'text', text: 'accepted' }], details: {} };
    } }] };
  const r = await runAgent({ request: request(), definition: def, maxTurns: 1,
    ...fixture([fauxAssistantMessage(fauxToolCall('submit', {}), { stopReason: 'toolUse' })]) });
  assert.equal(r.status, 'ok'); assert.equal(r.request_id, 'req-a'); assert.equal(r.data.answer, 'submitted');
});
test('rejects malformed request and wrong-role operation before calling model', async () => {
  const streamFn = () => { throw new Error('must not call'); };
  for (const req of [null, { ...request(), operation: 'evaluator.evaluate' }, { ...request(), input_revision: -1 }]) {
    const r = await runAgent({ request: req, definition, streamFn });
    assert.equal(r.error.code, 'INVALID_INPUT');
  }
});
test('rejects malformed JSON, invalid schema and provider failure', async () => {
  for (const [msg, code] of [
    [fauxAssistantMessage('not JSON'), 'INVALID_OUTPUT'],
    [fauxAssistantMessage(output(123)), 'INVALID_OUTPUT'],
    [fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'private payload' }), 'MODEL_ERROR'],
  ]) {
    const r = await runAgent({ request: request(), definition, ...fixture([msg]) });
    assert.equal(r.error.code, code); assert.ok(!JSON.stringify(r).includes('private payload'));
  }
});
test('real Pi loop executes a scoped tool then obtains final response', async () => {
  let executed = 0; const events = [];
  const def = { ...definition, createTools: req => [{
    name: 'get_member', label: 'Member', description: 'Return authorized member identifier', parameters: Type.Object({}),
    execute: async () => { executed++; return { content: [{ type: 'text', text: req.payload.member_id }], details: {} }; },
  }] };
  const r = await runAgent({ request: request(), definition: def, onProgress: e => events.push(e),
    ...fixture([fauxAssistantMessage(fauxToolCall('get_member', {}), { stopReason: 'toolUse' }),
      context => { assert.ok(context.messages.some(m => m.role === 'toolResult')); return fauxAssistantMessage(output('done')); }]),
  });
  assert.equal(r.status, 'ok'); assert.equal(executed, 1);
  assert.ok(events.some(e => e.type === 'tool_execution_start'));
  assert.ok(events.every(e => Object.keys(e).length === 2));
});
test('fresh contexts isolate consecutive members', async () => {
  for (const member of ['PRIVATE_A', 'PRIVATE_B']) {
    const other = member === 'PRIVATE_A' ? 'PRIVATE_B' : 'PRIVATE_A';
    const r = await runAgent({ request: request(member), definition, ...fixture([context => {
      assert.ok(!JSON.stringify(context).includes(other)); return fauxAssistantMessage(output(member));
    }]) });
    assert.equal(r.data.answer, member);
  }
});
test('turn budget stops tool loops', async () => {
  const r = await runAgent({ request: request(), definition, maxTurns: 1,
    ...fixture([fauxAssistantMessage(fauxToolCall('unknown', {}), { stopReason: 'toolUse' })]),
  });
  assert.equal(r.error.code, 'BUDGET_EXCEEDED');
});
test('tool budget blocks execution past the limit in a single turn', async () => {
  let executed = 0;
  const def = { ...definition, createTools: () => [{ name: 'lookup', label: 'Lookup',
    description: 'Read a fixture', parameters: Type.Object({}),
    execute: async () => { executed++; return { content: [{ type: 'text', text: 'fixture' }], details: {} }; },
  }] };
  const r = await runAgent({ request: request(), definition: def, maxToolCalls: 1,
    ...fixture([fauxAssistantMessage([fauxToolCall('lookup', {}, {id: 't1'}), fauxToolCall('lookup', {}, {id: 't2'})], {stopReason: 'toolUse'}),
      fauxAssistantMessage(output('done'))]),
  });
  assert.equal(executed, 1); assert.equal(r.error.code, 'BUDGET_EXCEEDED');
});
test('deadline returns structured timeout even for a stalled provider', async () => {
  const r = await runAgent({ request: request(), definition, timeoutMs: 20,
    ...fixture([() => new Promise(resolve => setTimeout(() => resolve(fauxAssistantMessage(output('late'))), 60))]),
  });
  assert.equal(r.error.code, 'MODEL_TIMEOUT');
});
test('example refuses member mismatch and eighth interview round', () => {
  const spec = example.operations['interview.turn'];
  assert.equal(spec.validateInput({ member_id: 'a', mode: 'initial', round_index: 8, messages: [] }), false);
  assert.equal(spec.validateOutput({ member_id: 'b' }, { member_id: 'a' }), false);
});
