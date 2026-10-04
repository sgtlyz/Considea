import test from 'node:test';
import assert from 'node:assert/strict';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { fixture } from './fixtures.mjs';
import { runIdea } from './service.mjs';
import { createOfflineRuntime, finalMessage } from './offline.mjs';
import { ideaOutputSchema } from './definition.mjs';

test('tool-free Idea corrects one malformed JSON response then validates generate and revise', async () => {
  for (const operation of ['idea.generate', 'idea.revise']) {
    const f = fixture(operation); let calls = 0;
    const result = await runIdea({ request: f.request, runtime: createOfflineRuntime([
      () => { calls++; return fauxAssistantMessage('{'); },
      context => { calls++; assert.ok(JSON.stringify(context).includes('INVALID_JSON')); return finalMessage(f.response.data); },
    ]) });
    assert.equal(result.status, 'ok'); assert.equal(calls, 2); assert.deepEqual(result.data, f.response.data);
  }
});

test('Idea output schema binds exact candidate slots, source IDs and revision reference', () => {
  const f = fixture('idea.generate'), s = ideaOutputSchema(f.request.operation, f.request.payload);
  assert.equal(s.properties.data.properties.candidates.minItems, f.request.payload.candidate_slots.length);
  assert.deepEqual(s.properties.data.properties.candidates.items.properties.slot_id.enum, f.request.payload.candidate_slots);
  const r = fixture('idea.revise');
  assert.deepEqual(ideaOutputSchema(r.request.operation, r.request.payload).properties.data.properties.base_candidate_ref.const, r.request.payload.candidate.candidate_ref);
});

test('Idea memory and research modes never retry output or repeat tools', async () => {
  for (const research of [false, true]) {
    const f = fixture('idea.generate', { research }); let calls = 0;
    const result = await runIdea({ request: f.request, ...(!research ? { memoryClient: {} } : {}), runtime: createOfflineRuntime([
      () => { calls++; return fauxAssistantMessage('{'); },
      () => { calls++; assert.fail('tool-bearing mode must not retry'); },
    ]) });
    assert.equal(result.error.code, 'INVALID_OUTPUT'); assert.equal(calls, 1);
  }
});

test('Idea rejects foreign source references even after one correction', async () => {
  const f = fixture('idea.generate');
  const bad = structuredClone(f.response.data); bad.candidates[0].draft.discussion_source_ids = ['foreign-source'];
  let calls = 0;
  const result = await runIdea({ request: f.request, runtime: createOfflineRuntime([
    () => { calls++; return finalMessage(bad); }, () => { calls++; return finalMessage(bad); },
  ]) });
  assert.equal(result.error.code, 'INVALID_OUTPUT'); assert.equal(calls, 2); assert.deepEqual(result.data, {});
});

test('observed nested warnings plus missing outer brace preserves the validated candidate', async () => {
  const f = fixture('idea.generate');
  const data = { ...structuredClone(f.response.data), warnings: ['Known uncertainty'] };
  const raw = JSON.stringify({ status: 'ok', data }).slice(0, -1);
  const result = await runIdea({ request: f.request, runtime: createOfflineRuntime([fauxAssistantMessage(raw)]) });
  assert.equal(result.status, 'ok'); assert.deepEqual(result.data, f.response.data);
  assert.ok(result.warnings.includes('Known uncertainty'));
  assert.ok(result.warnings.some(w => w.startsWith('MODEL_JSON_CLOSED')));
});

test('member-input schema and diagnostics exclude synthesized discussion sources', async () => {
  const f = fixture('idea.generate'), p = f.request.payload;
  const s = ideaOutputSchema(f.request.operation, p);
  const allowed = new Set(s.$defs.MemberInputSourceId.enum ?? []);
  for (const source of p.shared_context.sources) {
    if (['difference', 'convergence_decision', 'human_review'].includes(source.kind)) assert.ok(!allowed.has(source.source_id));
  }
  const bad = structuredClone(f.response.data);
  const wrong = p.shared_context.sources.find(s => s.kind === 'difference');
  assert.ok(wrong);
  bad.candidates[0].draft.contributions[0].origin = 'member_input';
  bad.candidates[0].draft.contributions[0].source_ids = [wrong.source_id];
  let calls = 0;
  const result = await runIdea({ request: f.request, runtime: createOfflineRuntime([
    () => { calls++; return finalMessage(bad); }, context => {
      calls++; assert.ok(JSON.stringify(context).includes('MEMBER_INPUT_REQUIRES_CURRENT_MEMBER_STATEMENT_OR_ANSWER'));
      return finalMessage(f.response.data);
    },
  ]) });
  assert.equal(result.status, 'ok'); assert.equal(calls, 2);
});


test('extra brace in generate and revise preserves candidates and sources with one model request', async () => {
  for (const operation of ['idea.generate', 'idea.revise']) {
    const f = fixture(operation);
    const raw = JSON.stringify({ status: 'ok', data: f.response.data, warnings: [] });
    const malformed = raw.replace(/(\"must_have\":(?:true|false))}/, '$1}}');
    assert.notEqual(malformed, raw);
    let calls = 0;
    const result = await runIdea({ request: f.request, runtime: createOfflineRuntime([
      () => { calls++; return fauxAssistantMessage(malformed); }, () => assert.fail('unexpected paid correction'),
    ]) });
    assert.equal(result.status, 'ok'); assert.equal(calls, 1);
    assert.deepEqual(result.data, f.response.data);
    assert.ok(result.warnings.some(w => w.startsWith('MODEL_JSON_EXTRA_BRACE_REMOVED')));
  }
});

test('brace repair cannot legitimize a foreign source or wrong candidate version', async () => {
  for (const wrongVersion of [false, true]) {
    const f = fixture('idea.revise');
    const data = structuredClone(f.response.data);
    if (wrongVersion) data.base_candidate_ref.version++;
    else data.draft.discussion_source_ids = ['foreign-source'];
    const raw = JSON.stringify({ status: 'ok', data, warnings: [] }) + '}';
    let calls = 0;
    const result = await runIdea({ request: f.request, runtime: createOfflineRuntime([
      () => { calls++; return fauxAssistantMessage(raw); }, () => { calls++; return fauxAssistantMessage(raw); },
    ]) });
    assert.equal(result.error.code, 'INVALID_OUTPUT'); assert.equal(calls, 2);
    assert.deepEqual(result.data, {});
  }
});
