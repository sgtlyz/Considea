import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import definition, {
  createIdeaDefinition, validateRequest, validateGenerateInput, validateReviseInput,
  validateGenerateData, validateReviseData, validateResponse,
} from './definition.mjs';
import { fixture } from './fixtures.mjs';
import { schemaFor } from './contracts/schema.mjs';

const evidence = () => ({
  evidence_key: 'research-1', url: 'https://www.reddit.com/r/hackathon/comments/example',
  title: 'Offline example', accessed_at: '2026-10-03T12:00:00Z', source_kind: 'reddit',
  excerpt: 'A fictional example of a problem.', content_level: 'snippet',
  limitation: 'Offline fixture; not actual retrieved evidence.',
});
const inspiration = () => ({
  evidence_key: 'research-1', borrowed_mechanism: 'Asynchronous preference cards',
  adaptation: 'Show team tradeoffs before selection', known_difference: 'The MVP preserves manual confirmation',
});

for (const operation of ['generate', 'revise']) {
  for (const research of [false, true]) {
    test(`${operation} accepts the canonical ${research ? '2.1-augmented' : '2.0'} fixture`, () => {
      const { request, response } = fixture(operation, { research });
      assert.equal(validateRequest(request), true);
      assert.equal(definition.operations[request.operation].validateOutput(response.data, request.payload), true);
    });
  }
}

test('request rejects unknown envelope fields, wrong operation, wrong versions, and null', () => {
  assert.equal(validateRequest(null), false);
  for (const mutate of [
    request => { request.approved = true; },
    request => { request.operation = 'interview.turn'; },
    request => { request.schema_version = '2.1'; },
    request => { request.payload.contract_version = '3.0'; },
  ]) {
    const { request } = fixture('generate');
    mutate(request);
    assert.equal(validateRequest(request), false);
  }
});

test('profile sources bind exact member, profile version, text, and source kind', () => {
  for (const mutate of [
    source => { source.member_id = 'member-b'; },
    source => { source.object_ref.version += 1; },
    source => { source.object_ref.id = 'different-profile'; },
    source => { source.kind = 'difference_answer'; },
    source => { source.text = 'Rewritten by someone else'; },
  ]) {
    const { request } = fixture('generate');
    mutate(request.payload.shared_context.sources[0]);
    assert.equal(validateGenerateInput(request.payload), false);
  }
});

test('duplicate source, profile item, profile member, and room constraint identifiers are rejected', () => {
  for (const mutate of [
    p => p.shared_context.sources.push(structuredClone(p.shared_context.sources[0])),
    p => p.shared_context.profiles[0].items.push(structuredClone(p.shared_context.profiles[0].items[0])),
    p => p.shared_context.profiles.push(structuredClone(p.shared_context.profiles[0])),
    p => { p.room_context.constraints = Array.from({ length: 2 }, () => ({
      constraint_id: 'same', text: 'Example', verification: 'unknown', acceptance: 'proposed',
    })); },
  ]) {
    const { request } = fixture('generate');
    mutate(request.payload);
    assert.equal(validateGenerateInput(request.payload), false);
  }
});

test('history must be ordered and source-typed with valid rounds and no dangling ids', () => {
  for (const mutate of [
    p => p.shared_context.discussion_history.reverse(),
    p => { p.shared_context.discussion_history[1].discussion_round = 1; },
    p => { p.shared_context.discussion_history[0].answer_source_ids = ['difference-1-source']; },
    p => { p.shared_context.discussion_history[0].answer_source_ids = ['missing-answer']; },
    p => { p.shared_context.discussion_history[0].answer_source_ids = ['answer-2-1-source']; },
    p => { p.shared_context.sources[0].discussion_round = 5; },
    p => { p.shared_context.sources.find(s => s.kind === 'difference_answer').member_id = null; },
    p => { p.shared_context.sources[0].member_id = 'not-in-room'; },
  ]) {
    const { request } = fixture('generate');
    mutate(request.payload);
    assert.equal(validateGenerateInput(request.payload), false);
  }
});

test('approved profile sources may appear again in later discussion rounds', () => {
  const { request } = fixture('generate');
  assert.equal(request.payload.shared_context.sources[0].discussion_round, 1);
  assert.equal(request.payload.shared_context.discussion_history[3].profile_source_ids.includes('profile-1-v1-item-1'), true);
  assert.equal(validateGenerateInput(request.payload), true);
});

test('generation requires current round four or later and the exact convergence source', () => {
  for (const mutate of [
    p => { p.discussion_round = 3; },
    p => { p.convergence_decision.discussion_round = 3; },
    p => { p.convergence_decision.decision = 'diverge'; },
    p => { p.convergence_decision.decision_ref.version += 1; },
    p => { p.convergence_decision.source_ids = ['answer-4-1-source']; },
    p => { p.convergence_decision.source_ids = ['fabricated-event']; },
    p => { p.shared_context.discussion_history[3].convergence_source_ids = []; },
    p => { p.shared_context.sources.find(s => s.kind === 'convergence_decision').discussion_round = 3; },
  ]) {
    const { request } = fixture('generate');
    mutate(request.payload);
    assert.equal(validateGenerateInput(request.payload), false);
  }
});

test('candidate slots are an exact set, not a model-controlled count or identity', () => {
  for (const mutate of [
    data => data.candidates.pop(),
    data => data.candidates.push(structuredClone(data.candidates[0])),
    data => { data.candidates[0].slot_id = 'invented-slot'; },
    data => { data.candidates[0].slot_id = data.candidates[1].slot_id; },
  ]) {
    const { request, response } = fixture('generate');
    mutate(response.data);
    assert.equal(validateGenerateData(response.data, request.payload), false);
  }
  const { request, response } = fixture('generate');
  response.data.candidates.reverse();
  assert.equal(validateGenerateData(response.data, request.payload), true);
  request.payload.candidate_slots.push(request.payload.candidate_slots[0]);
  assert.equal(validateGenerateInput(request.payload), false);
});

test('outputs cannot add authority fields, private data, unknown sources, or duplicate dependencies', () => {
  for (const mutate of [
    draft => { draft.candidate_ref = { id: 'invented', version: 1 }; },
    draft => { draft.approved = true; },
    draft => { draft.private_message_ids = ['private-1']; },
    draft => { draft.discussion_source_ids = ['source-not-provided']; },
    draft => { draft.contributions[0].source_ids = ['source-not-provided']; },
    draft => { draft.critical_dependencies.push(structuredClone(draft.critical_dependencies[0])); },
    draft => { draft.target_users = []; },
  ]) {
    const { request, response } = fixture('generate');
    mutate(response.data.candidates[0].draft);
    assert.equal(validateGenerateData(response.data, request.payload), false);
  }
});

test('member_input requires member-backed profile or answer sources, not synthesis or no source', () => {
  for (const ids of [[], ['difference-1-source'], ['convergence-4-source'], ['profile-1-v1-item-1', 'difference-1-source']]) {
    const { request, response } = fixture('generate');
    response.data.candidates[0].draft.contributions[0].source_ids = ids;
    assert.equal(validateGenerateData(response.data, request.payload), false);
  }
  const { request, response } = fixture('generate');
  response.data.candidates[0].draft.contributions[0].source_ids = ['answer-4-1-source'];
  assert.equal(validateGenerateData(response.data, request.payload), true);
});

test('a profile agent inference cannot be relabeled as a member contribution', () => {
  const { request, response } = fixture('generate');
  request.payload.shared_context.profiles[0].items[0].basis = 'agent_inference';
  assert.equal(validateGenerateInput(request.payload), true);
  assert.equal(validateGenerateData(response.data, request.payload), false);
  for (const candidate of response.data.candidates) candidate.draft.contributions[0].origin = 'agent_synthesis';
  assert.equal(validateGenerateData(response.data, request.payload), true);
});

test('historical profile text with unknown basis remains context but cannot become member_input', () => {
  const { request, response } = fixture('generate');
  const historicalId = 'historical-profile-item';
  request.payload.shared_context.sources.push({
    source_id: historicalId, kind: 'profile_item', object_ref: { id: 'older-profile', version: 1 },
    member_id: 'member-a', discussion_round: 1, text: 'Historical profile text with no statement/inference basis.',
  });
  request.payload.shared_context.discussion_history[0].profile_source_ids.push(historicalId);
  const draft = response.data.candidates[0].draft;
  draft.discussion_source_ids.push(historicalId);
  assert.equal(validateGenerateInput(request.payload), true);
  assert.equal(validateGenerateData(response.data, request.payload), true);
  draft.contributions[0].source_ids = [historicalId];
  assert.equal(validateGenerateData(response.data, request.payload), false);
  draft.contributions[0].origin = 'agent_synthesis';
  assert.equal(validateGenerateData(response.data, request.payload), true);
});

test('revisions bind evaluation and every review to exact candidate/evaluation versions', () => {
  for (const mutate of [
    p => { p.evaluation.content.candidate_ref.version += 1; },
    p => { p.reviews[0].candidate_ref.id = 'other-candidate'; },
    p => { p.reviews[0].candidate_ref.version += 1; },
    p => { p.reviews[0].evaluation_ref.version += 1; },
    p => { p.reviews[0].evaluation_ref.id = 'other-evaluation'; },
    p => { p.reviews[0].decision = 'accept'; },
    p => { p.reviews[0].decision = 'more_discussion'; },
    p => { p.reviews[0].instructions = '  \n'; },
    p => { p.reviews[0].member_id = 'outside-room'; },
    p => p.reviews.push(structuredClone(p.reviews[0])),
    p => { p.candidate.content.discussion_source_ids = ['withdrawn-source']; },
  ]) {
    const { request } = fixture('revise');
    mutate(request.payload);
    assert.equal(validateReviseInput(request.payload), false);
  }
});

test('revision evaluation findings must resolve current dependencies and evidence keys', () => {
  for (const mutate of [
    p => { p.evaluation.content.findings[0].dependency_key = 'wrong-dependency'; },
    p => { p.evaluation.content.findings[0].evidence_keys = ['nonexistent']; },
  ]) {
    const { request } = fixture('revise');
    mutate(request.payload);
    assert.equal(validateReviseInput(request.payload), false);
  }
});

test('an optional current human review Source must exactly match its stored review', () => {
  const { request } = fixture('revise');
  const review = request.payload.reviews[0];
  const source = {
    source_id: 'current-review', kind: 'human_review', object_ref: structuredClone(review.review_ref),
    member_id: review.member_id, discussion_round: 4, text: review.instructions,
  };
  request.payload.shared_context.sources.push(source);
  assert.equal(validateReviseInput(request.payload), true);
  source.text = 'Replaced instructions';
  assert.equal(validateReviseInput(request.payload), false);
});

test('revision output cannot bump versions, target another candidate, or omit change explanation', () => {
  for (const mutate of [
    data => { data.base_candidate_ref.version += 1; },
    data => { data.base_candidate_ref.id = 'other-candidate'; },
    data => { data.draft.change_summary = ' \n'; },
    data => { data.draft.discussion_source_ids = ['invented']; },
  ]) {
    const { request, response } = fixture('revise');
    mutate(response.data);
    assert.equal(validateReviseData(response.data, request.payload), false);
  }
});

test('research is an explicit versioned extension, not permissive extras on 2.0', () => {
  const legacy = fixture('generate');
  legacy.request.payload.search_policy = { enabled: false, max_queries: 0, max_results_per_query: 1, required: false };
  assert.equal(validateRequest(legacy.request), false);
  delete legacy.request.payload.search_policy;
  legacy.response.data.candidates[0].draft.inspiration_refs = [];
  assert.equal(validateGenerateData(legacy.response.data, legacy.request.payload), false);
  const research = fixture('revise', { research: true });
  delete research.request.payload.candidate.content.inspiration_refs;
  assert.equal(validateRequest(research.request), false);
});

test('2.1 strictly checks search policy and evidence shape, date, domain, and keys', () => {
  for (const mutate of [
    p => { delete p.search_policy.required; },
    p => { p.search_policy.max_queries = 9; },
    p => { p.search_policy.max_queries = -1; },
    p => { p.search_policy.max_results_per_query = 6; },
    p => { p.search_policy.max_results_per_query = 0; },
    p => { p.provided_evidence[0].accessed_at = 'yesterday'; },
    p => { p.provided_evidence[0].url = 'javascript:alert(1)'; },
    p => { p.provided_evidence[0].url = 'http://www.reddit.com/path'; },
    p => { p.provided_evidence[0].url = 'https://user:password@www.reddit.com/path'; },
    p => { p.provided_evidence[0].url = 'https://reddit.com.unrelated.example/path'; },
    p => { p.provided_evidence[0].url = 'https://127.0.0.1/path'; p.provided_evidence[0].source_kind = 'web'; },
    p => { p.provided_evidence[0].url = 'https://intranet.local/path'; p.provided_evidence[0].source_kind = 'web'; },
    p => { p.provided_evidence[0].url = 'https://www.reddit.com/' + 'a'.repeat(2048); },
    p => { p.provided_evidence[0].title = 'x'.repeat(201); },
    p => { p.provided_evidence[0].excerpt = 'x'.repeat(1201); },
    p => { p.provided_evidence = Array.from({ length: 41 }, (_, i) => ({ ...evidence(), evidence_key: `ref-${i}` })); },
    p => { p.provided_evidence[0].content_level = 'full_page'; },
    p => { p.provided_evidence[0].approved = true; },
    p => p.provided_evidence.push(evidence()),
  ]) {
    const { request } = fixture('generate', { research: true });
    request.payload.provided_evidence.push(evidence());
    mutate(request.payload);
    assert.equal(validateRequest(request), false);
  }
  const { request } = fixture('generate', { research: true });
  request.payload.search_policy.enabled = false;
  request.payload.search_policy.max_queries = 0;
  request.payload.provided_evidence.push(evidence());
  assert.equal(validateRequest(request), true);
});

test('model data contains inspiration refs but cannot fabricate the service ledger', () => {
  const { request, response } = fixture('generate', { research: true });
  response.data.candidates[0].draft.inspiration_refs = [inspiration()];
  // The actual tool ledger is only known after model execution, so service
  // validation, not this stateless definition, resolves this evidence key.
  assert.equal(validateGenerateData(response.data, request.payload), true);
  response.data.research = { evidence: [evidence()], search_log: [] };
  assert.equal(validateGenerateData(response.data, request.payload), false);
  delete response.data.research;
  response.data.candidates[0].draft.inspiration_refs.push(inspiration());
  assert.equal(validateGenerateData(response.data, request.payload), false);
});

test('schemas keep 2.0 unchanged and require a service research sidecar for 2.1 responses', () => {
  const canonicalBefore = readFileSync(new URL('../interfaces/protocol.schema.json', import.meta.url), 'utf8');
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const legacy = ajv.compile(schemaFor());
  const research = ajv.compile(schemaFor('2.1'));
  const oldFixture = fixture('generate');
  const newFixture = fixture('generate', { research: true });
  assert.equal(legacy(oldFixture.request), true);
  assert.equal(legacy(oldFixture.response), true);
  assert.equal(legacy(newFixture.request), false);
  assert.equal(research(newFixture.request), true);
  assert.equal(research(newFixture.response), true);
  delete newFixture.response.research;
  assert.equal(research(newFixture.response), false);
  oldFixture.response.research = { evidence: [], search_log: [] };
  assert.equal(legacy(oldFixture.response), false);
  assert.equal(readFileSync(new URL('../interfaces/protocol.schema.json', import.meta.url), 'utf8'), canonicalBefore);
});

test('fixtures are isolated deep clones and definitions receive request-scoped tools', () => {
  const first = fixture('generate', { research: true });
  first.request.payload.shared_context.sources[0].text = 'Mutated';
  assert.notEqual(fixture('generate').request.payload.shared_context.sources[0].text, 'Mutated');
  const createTools = () => [];
  assert.equal(createIdeaDefinition({ createTools }).createTools, createTools);
  assert.equal(definition.name, 'idea');
  assert.equal(definition.createTools, undefined);
  for (const operation of Object.values(definition.operations)) {
    assert.match(operation.outputInstructions, /critical_dependencies/);
    assert.match(operation.outputInstructions, /inspiration_refs/);
  }
});

test('final response and cached replay require exact headers and complete response validation', () => {
  for (const research of [false, true]) {
    for (const operation of ['generate', 'revise']) {
      const { request, response } = fixture(operation, { research });
      assert.equal(validateResponse(request, response), true);
    }
  }
  for (const mutate of [
    r => { r.room_id = 'different-room'; },
    r => { r.input_revision += 1; },
    r => { r.status = 'partial'; },
    r => { r.warnings = ['']; },
    r => { r.data.candidates[0].draft.approved = true; },
    r => { r.data.candidates[0].draft.discussion_source_ids = ['invented']; },
    r => { r.data.candidates[0].slot_id = 'invented'; },
  ]) {
    const { request, response } = fixture('generate');
    mutate(response);
    assert.equal(validateResponse(request, response), false);
  }
});

test('final research response binds supplied evidence byte fields and actual logged tool references', () => {
  const { request, response } = fixture('generate', { research: true });
  request.payload.provided_evidence = [evidence()];
  response.research.evidence = [evidence()];
  response.data.candidates[0].draft.inspiration_refs = [inspiration()];
  assert.equal(validateResponse(request, response), true);
  response.research.evidence[0].excerpt = 'Changed after trusted retrieval';
  assert.equal(validateResponse(request, response), false);
  response.research.evidence = [evidence(), { ...evidence(), evidence_key: 'tool-1' }];
  assert.equal(validateResponse(request, response), false);
  response.research.search_log = [{ query: 'team tradeoffs', source_kind: 'reddit', result_status: 'results', evidence_keys: ['tool-1'] }];
  assert.equal(validateResponse(request, response), true);
  response.research.search_log[0].source_kind = 'devpost';
  assert.equal(validateResponse(request, response), false);
});

test('final ledger rejects invented, duplicate, mismatched, disabled, or over-budget search evidence', () => {
  for (const mutate of [
    ({ response }) => { response.research.search_log[0].evidence_keys = ['missing']; },
    ({ response }) => { response.research.evidence.push(evidence()); },
    ({ response }) => { response.research.search_log[0].result_status = 'failed'; },
    ({ response }) => { response.research.search_log[0].query = ''; },
    ({ response }) => { response.research.search_log.push(structuredClone(response.research.search_log[0])); },
    ({ request }) => { request.payload.search_policy.max_queries = 0; },
    ({ request }) => { request.payload.search_policy.enabled = false; },
    ({ response }) => { response.research.evidence[0].url = 'https://localhost/local'; },
    ({ response }) => { response.data.candidates[0].draft.inspiration_refs[0].evidence_key = 'invented'; },
    ({ request }) => { request.payload.search_policy.required = true; },
  ]) {
    const state = fixture('generate', { research: true });
    state.response.research.evidence = [evidence()];
    state.response.research.search_log = [{ query: 'team tradeoffs', source_kind: 'reddit', result_status: 'results', evidence_keys: ['research-1'] }];
    state.response.data.candidates[0].draft.inspiration_refs = [inspiration()];
    assert.equal(validateResponse(state.request, state.response), true);
    mutate(state);
    assert.equal(validateResponse(state.request, state.response), false);
  }
});

test('early errors may have an empty research ledger even with supplied evidence', () => {
  const { request, response } = fixture('generate', { research: true });
  request.payload.provided_evidence = [evidence()];
  response.status = 'error';
  response.data = {};
  response.error = { code: 'CONFIG_ERROR', message: 'No runtime configured', retryable: false };
  assert.equal(validateResponse(request, response), true);
  response.data.fabricated_candidate = {};
  assert.equal(validateResponse(request, response), false);
});
