import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInterview } from './service.mjs';
import { createOfflineRuntime } from '../pi-base/offline.mjs';
const pair = name => JSON.parse(readFileSync(new URL(`./examples/${name}.json`, import.meta.url), 'utf8'));
test('known flattened summary with notes is repaired once locally without changing facts', async () => {
  const x = pair('interview-summary-v2'), raw = structuredClone(x.response.data);
  raw.profile_draft.notes = ['Synthetic test only']; raw.warnings = [];
  let calls = 0;
  const result = await runInterview({ request:x.request, runtime:createOfflineRuntime(() => { calls++; return raw; }) });
  assert.equal(result.status, 'ok'); assert.equal(calls, 1);
  assert.deepEqual(result.data, x.response.data); assert.ok(result.warnings.includes('Synthetic test only'));
});
test('question status is derived from strictly validated question content', async () => {
  const x = pair('interview-turn-v2');
  const result = await runInterview({ request:x.request, runtime:createOfflineRuntime(() => ({status:'ok', data:x.response.data, warnings:[]})) });
  assert.equal(result.status,'needs_input'); assert.deepEqual(result.data,x.response.data);
});
test('normalization never launders extra approvals, foreign evidence, IDs or unsupported categories', async () => {
  for (const change of [r=>{r.approved=true;}, r=>{r.data.profile_draft.approved=true;},
    r=>{r.data.member_id='outsider';},r=>{r.data.profile_draft.items[0].private_message_ids=['foreign'];},
    r=>{r.data.profile_draft.items[0].category='invented';},r=>{r.data.profile_draft.items[0].text='';}]) {
    const x=pair('interview-summary-v2'), raw={status:'ok',data:x.response.data,warnings:[]}; change(raw);
    const r=await runInterview({request:x.request,runtime:createOfflineRuntime(()=>raw)});
    assert.equal(r.error?.code,'INVALID_OUTPUT');
  }
});

// Observed with live DeepSeek: three different constraints reused item_key=constraint.
test('summary rejects duplicate temporary item keys without dropping member facts', async () => {
  const x = pair('interview-summary-v2');
  const raw = { status: 'ok', data: structuredClone(x.response.data), warnings: [] };
  const first = raw.data.profile_draft.items[0];
  raw.data.profile_draft.items.push({ ...structuredClone(first), text: 'A second distinct member constraint.' });
  const result = await runInterview({ request: x.request, runtime: createOfflineRuntime(() => raw) });
  assert.equal(result.error?.code, 'INVALID_OUTPUT');
  assert.deepEqual(result.data, {});
});

test('summary rejects structured unknowns that do not match the string-array contract', async () => {
  const x = pair('interview-summary-v2');
  const raw = { status: 'ok', data: structuredClone(x.response.data), warnings: [] };
  raw.data.profile_draft.unknowns = [{ text: 'Which feature is essential?', related_item_keys: ['item-1'] }];
  const result = await runInterview({ request: x.request, runtime: createOfflineRuntime(() => raw) });
  assert.equal(result.error?.code, 'INVALID_OUTPUT');
});

test('nested transport warnings move to the envelope without changing validated summary facts', async () => {
  const x = pair('interview-summary-v2');
  const original = structuredClone(x.response.data);
  const raw = { status: 'ok', data: { ...structuredClone(original), warnings: ['Synthetic caveat'] }, warnings: ['Envelope caveat'] };
  const result = await runInterview({ request: x.request, runtime: createOfflineRuntime(() => raw) });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data, original);
  assert.ok(result.warnings.includes('Synthetic caveat'));
  assert.ok(result.warnings.includes('Envelope caveat'));
  assert.deepEqual(raw.data.warnings, ['Synthetic caveat']);
  raw.data.warnings = [{ approved: true }];
  const rejected = await runInterview({ request: x.request, runtime: createOfflineRuntime(() => raw) });
  assert.equal(rejected.error?.code, 'INVALID_OUTPUT');
});
