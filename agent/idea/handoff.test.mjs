import test from 'node:test';
import assert from 'node:assert/strict';
import { projectForV2Evaluator } from './handoff.mjs';
import { fixture } from './fixtures.mjs';
import { runDemo } from './demo.mjs';

test('v2 evaluator projection preserves canonical content and separately retains all research', async () => {
  const response = await runDemo();
  const draft = response.data.candidates[0].draft;
  const snapshot = structuredClone(draft);
  const ref = { id: 'workflow-persisted-candidate', version: 1 };
  const result = projectForV2Evaluator({ candidateRef: ref, draft, research: response.research });
  assert.deepEqual(result.candidate.candidate_ref, ref);
  assert.equal('inspiration_refs' in result.candidate.content, false);
  assert.deepEqual(result.research.inspiration_refs, draft.inspiration_refs);
  assert.deepEqual(result.research.evidence, response.research.evidence);
  assert.deepEqual(draft, snapshot);
});

test('projection rejects authority extras, invalid assigned ref and unresolved evidence', () => {
  const draft = fixture('idea.generate', { research: true }).response.data.candidates[0].draft;
  const candidateRef = { id: 'candidate', version: 1 };
  assert.throws(() => projectForV2Evaluator({ candidateRef: { id: 'candidate', version: 0 }, draft }));
  assert.throws(() => projectForV2Evaluator({ candidateRef, draft: { ...draft, approved: true } }));
  assert.throws(() => projectForV2Evaluator({ candidateRef, draft: { ...draft, inspiration_refs: [{ evidence_key: 'fake' }] } }));
});
