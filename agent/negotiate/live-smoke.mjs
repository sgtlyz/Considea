import assert from 'node:assert/strict';
import { runNegotiator } from './service.mjs';
import { liveRuntime } from '../pi-base/integration-runtime.mjs';

if (!process.argv.includes('--live') || process.env.CONCLAVE_RUN_LIVE !== '1') {
  throw new Error('Opt in with --live and CONCLAVE_RUN_LIVE=1; this calls the configured provider with synthetic inputs.');
}

function requestFor(name, entries) {
  const profiles = [], sources = [];
  for (const [member, texts] of Object.entries(entries)) {
    const profile_ref = { id: `profile-${member}`, version: 1 };
    const items = texts.map((text, i) => {
      const source_id = `${member}-${i}`;
      sources.push({ source_id, kind: 'profile_item', object_ref: profile_ref, member_id: member, discussion_round: 1, text });
      return { item_id: source_id, category: 'goal', text, basis: 'member_statement', confidence: 'high', source_id };
    });
    profiles.push({ profile_ref, member_id: member, items, unknowns: [] });
  }
  return { schema_version: '1.0', request_id: `smoke-${name}`, room_id: `synthetic-${name}`,
    operation: 'negotiate.detect', input_revision: 1, payload: { contract_version: '2.0', discussion_round: 1,
      room_context: { member_ids: Object.keys(entries), hackathon_context: 'Synthetic two-member hackathon. English discussion.',
        deadline_at: null, constraints: [] }, shared_context: { profiles, discussion_history: [], sources } } };
}

const cases = [
  { name: 'genuine-team-difference', entries: {
    alice: ['I will only participate if our primary users are practicing clinicians; I do not want to build for students.'],
    bob: ['I will only participate if our primary users are university students; I do not want a clinical product.'],
  }, kind: 'difference', members: ['alice', 'bob'] },
  { name: 'compatible-preferences', entries: {
    alice: ['I am interested in health detection, but I am happy to build another useful software project.',
      'I would still join if the final project is not about health.'],
    bob: ['I support either a health project or another useful software project; I have no strict domain requirement.'],
  }, kind: 'clarification' },
  { name: 'personal-contradiction', entries: {
    alice: ['I can participate only if the project uses no hardware at all.',
      'I can participate only if we build a physical wearable with hardware sensors.'],
    bob: ['I can implement either a hardware prototype or a software-only prototype and have no preference.'],
  }, kind: 'clarification', members: ['alice'] },
];

let totalRequests = 0;
for (const item of cases) {
  const runtime = liveRuntime({ maxModelRequests: 2, maxTokens: 2048, timeoutMs: 60_000 });
  const response = await runNegotiator({ request: requestFor(item.name, item.entries), runtime });
  totalRequests += runtime.requestCount;
  assert.equal(response.status, 'ok', `${item.name}: ${response.error?.code}`);
  const d = response.data.difference;
  assert.equal(d.kind, item.kind, `${item.name}: unexpected classification`);
  if (item.members) assert.deepEqual([...d.affected_member_ids].sort(), [...item.members].sort(), item.name);
  console.log(JSON.stringify({ case: item.name, status: 'passed', model: runtime.model.id,
    model_requests: runtime.requestCount, kind: d.kind, affected_members: d.affected_member_ids,
    question: d.question, source_ids: d.source_ids }));
}
console.log(JSON.stringify({ status: 'passed', cases: cases.length, model_requests: totalRequests,
  scope: 'Bounded smoke test on synthetic inputs, not a statistical quality evaluation' }));
