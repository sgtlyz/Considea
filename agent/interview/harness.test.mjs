import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInterview } from './service.mjs';
import { createOfflineRuntime } from '../pi-base/offline.mjs';
import { interviewOutputSchema } from './definition.mjs';
const pair = name => JSON.parse(readFileSync(new URL(`./examples/${name}.json`, import.meta.url), 'utf8'));
const output = x => ({ status: x.response.status, data: structuredClone(x.response.data), warnings: [] });

test('omitted metadata and temporary keys are supplied without changing personal facts', async () => {
  const x = pair('interview-summary-v2'), raw = output(x);
  delete raw.data.member_id; delete raw.data.contract_version;
  for (const item of raw.data.profile_draft.items) delete item.item_key;
  const original = structuredClone(raw);
  const result = await runInterview({ request: x.request, runtime: createOfflineRuntime(() => raw) });
  assert.equal(result.status, 'ok'); assert.equal(result.data.member_id, x.request.payload.member_id);
  assert.equal(result.data.contract_version, x.request.payload.contract_version);
  assert.equal(new Set(result.data.profile_draft.items.map(i => i.item_key)).size, raw.data.profile_draft.items.length);
  const facts = result.data.profile_draft.items.map(({ item_key, ...item }) => item);
  assert.deepEqual(facts, raw.data.profile_draft.items); assert.deepEqual(raw, original);
});

test('schema is derived per request and restricts identity, question counts and source types', () => {
  const x = pair('interview-turn-v2'), p = x.request.payload;
  const schema = interviewOutputSchema(x.request.operation, p);
  assert.equal(schema.properties.data.properties.member_id.const, p.member_id);
  assert.equal(schema.properties.data.properties.questions.maxItems, p.limits.max_questions);
  assert.equal(schema.properties.data.properties.questions.items.properties.related_source_ids.items, false);
  assert.ok(!schema.properties.data.required.includes('member_id'));
  const y = pair('interview-summary-v2'), evidence = interviewOutputSchema(y.request.operation, y.request.payload).properties.data.properties.profile_draft.properties.items.items.properties.private_message_ids.items.enum;
  assert.deepEqual(evidence, y.request.payload.messages.filter(m => m.role === 'user' && m.content.trim()).map(m => m.message_id));
});

test('wrong field type is corrected once using schema feedback then fully validated', async () => {
  const x = pair('interview-summary-v2'); let calls = 0;
  const result = await runInterview({ request: x.request, runtime: createOfflineRuntime((p, context) => {
    calls++;
    assert.ok(JSON.stringify(context).includes('OUTPUT JSON SCHEMA'));
    const raw = output(x);
    if (calls === 1) raw.data.profile_draft.unknowns = [{ text: 'Wrong type' }];
    else {
      assert.ok(p.harness_output_correction.issues.some(i => i.code === 'SCHEMA_TYPE' && i.path.includes('unknowns')));
      assert.ok(JSON.stringify(context).includes(x.request.payload.member_id));
    }
    return raw;
  }) });
  assert.equal(result.status, 'ok'); assert.equal(calls, 2);
  assert.deepEqual(result.data, x.response.data);
});

test('wrong identity and foreign evidence stay rejected across both attempts', async () => {
  for (const field of ['identity', 'evidence']) {
    const x = pair('interview-summary-v2'); let calls = 0;
    const result = await runInterview({ request: x.request, runtime: createOfflineRuntime(() => {
      calls++; const raw = output(x);
      if (field === 'identity') raw.data.member_id = 'outsider';
      else raw.data.profile_draft.items[0].private_message_ids = ['another-member-private-message'];
      return raw;
    }) });
    assert.equal(result.error.code, 'INVALID_OUTPUT'); assert.equal(calls, 2); assert.deepEqual(result.data, {});
  }
});

test('caller runtime cannot replace role policy and later caller mutations cannot change authorization', async () => {
  const x = pair('interview-summary-v2'), expected = structuredClone(x.response.data);
  const rt = createOfflineRuntime(() => { x.request.payload.member_id = 'changed-by-caller'; return { status: 'ok', data: expected, warnings: [] }; });
  const result = await runInterview({ request: x.request, runtime: { ...rt, definition: {}, maxOutputRepairs: 99 } });
  assert.equal(result.status, 'ok'); assert.deepEqual(result.data, expected);
});
