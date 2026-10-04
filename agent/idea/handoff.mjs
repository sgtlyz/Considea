import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { schemaFor } from './contracts/schema.mjs';

const schema = schemaFor('2.0');
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validCandidate = ajv.compile({ $defs: schema.$defs, $ref: '#/$defs/Candidate' });

/** Workflow supplies the persisted candidate ref, after validating the full Idea response. */
export function projectForV2Evaluator({ candidateRef, draft, research = { evidence: [], search_log: [] } }) {
  const content = structuredClone(draft);
  const inspirationRefs = content.inspiration_refs ?? [];
  delete content.inspiration_refs;
  const candidate = { candidate_ref: structuredClone(candidateRef), content };
  if (!validCandidate(candidate)) throw new Error('Candidate does not satisfy the shared 2.0 contract');
  if (!Array.isArray(inspirationRefs) || !Array.isArray(research?.evidence) || !Array.isArray(research?.search_log)) {
    throw new Error('Invalid research handoff');
  }
  const evidenceKeys = new Set(research.evidence.map(item => item.evidence_key));
  if (inspirationRefs.some(ref => !evidenceKeys.has(ref.evidence_key))) throw new Error('Research handoff contains unresolved evidence references');
  return { candidate, research: { candidate_ref: structuredClone(candidateRef), inspiration_refs: structuredClone(inspirationRefs),
    evidence: structuredClone(research.evidence), search_log: structuredClone(research.search_log) } };
}
