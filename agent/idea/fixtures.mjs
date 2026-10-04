import { readFileSync } from 'node:fs';

const fixtures = Object.fromEntries(['generate', 'revise'].map(operation => [operation,
  JSON.parse(readFileSync(new URL(`../interfaces/fixtures/idea-${operation}.json`, import.meta.url), 'utf8')),
]));

/** Offline fixtures only. They are never evidence of a real human approval. */
export function fixture(operation, { research = false } = {}) {
  const key = operation.replace(/^idea\./, '');
  if (!fixtures[key]) throw new Error(`Unknown Idea fixture: ${operation}`);
  const result = structuredClone(fixtures[key]);
  if (research) {
    result.request.payload.contract_version = '2.1';
    result.request.payload.search_policy = {
      enabled: true, max_queries: 3, max_results_per_query: 3, required: false,
    };
    result.request.payload.provided_evidence = [];
    result.response.data.contract_version = '2.1';
    result.response.research = { evidence: [], search_log: [] };
    if (key === 'generate') {
      for (const candidate of result.response.data.candidates) candidate.draft.inspiration_refs = [];
    } else {
      result.request.payload.candidate.content.inspiration_refs = [];
      result.response.data.draft.inspiration_refs = [];
    }
  }
  return result;
}
