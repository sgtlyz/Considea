import { Type } from '@earendil-works/pi-ai';
import { validateDraft, object } from './contracts.mjs';

const exact = fields => Type.Object(fields, { additionalProperties: false });
const words = () => Type.String({ minLength: 1 });
const strings = () => Type.Array(words());
const choice = values => Type.Union(values.map(v => Type.Literal(v)));
const conclusion = () => choice(['documented_support', 'documented_blocker', 'member_reported', 'unknown']);
const test = () => exact({ result: choice(['pass', 'fail', 'insufficient_evidence']), reason: words(),
  evidence_ids: strings(), required_changes: strings(), missing_information: strings() });

function dataSchema(p) {
  const identity = { candidate_id: Type.Literal(p.candidate.candidate_id), candidate_version: Type.Literal(p.candidate.version) };
  if (p.question) return exact({ ...identity, issue_id: Type.Literal(p.question.issue_id), answer: words(),
    capability_outcome: choice(['available', 'blocked', 'unknown']),
    evidence_basis: choice(['official_documentation', 'member_report', 'unknown']),
    evidence_ids: strings(), limitations: strings(), recommended_next_step: words() });
  return exact({ ...identity, tests: exact({ novelty: test(), feasibility: test() }),
    competitors: Type.Array(exact({ name: words(), url: words(), overlap: strings(), differences: strings(),
      maturity: choice(['self_reported_implemented', 'planned', 'unknown']), evidence_ids: strings() }), { maxItems: 3 }),
    technical_checks: Type.Array(exact({ dependency_id: words(), finding: words(), conclusion: conclusion(),
      evidence_ids: strings(), next_check: Type.String() })), risks: strings(),
    unverified_assumptions: strings(), recommended_changes: strings() });
}

/** A per-request terminal submission; every path retains the existing ledger validator. */
export function createSubmission(payload, session, feedback) {
  let output, failures = 0;
  const reject = () => {
    if (output !== undefined) return false;
    failures++;
    if (failures > 1) output = {}; // Deliberately invalid sentinel: base ends with INVALID_OUTPUT.
    return failures === 1;
  };
  const wrap = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: {} });
  const draftData = data => {
    if (!payload.question || !object(data)) return data;
    const { capability_outcome, evidence_basis, ...draft } = data;
    const conclusion = capability_outcome === 'unknown' ? 'unknown' :
      evidence_basis === 'official_documentation' && ['available', 'blocked'].includes(capability_outcome) ?
        (capability_outcome === 'available' ? 'documented_support' : 'documented_blocker') :
      evidence_basis === 'member_report' && capability_outcome === 'available' ? 'member_reported' : undefined;
    return { ...draft, conclusion };
  };
  return { getOutput: () => output,
    onToolResult: event => {
      // SDK argument validation can reject a call before execute; it shares the correction allowance.
      if (event.toolName === 'submit_report' && event.isError) reject();
    },
    repairOutput: (result, p) => reject() ? feedback(result, p) : undefined,
    tool: { name: 'submit_report', label: 'Submit assessment',
      description: 'Submit the final assessment after research. The server validates source records and returns the response envelope. Exactly one correction is allowed for an invalid submission.',
      parameters: exact({ data: dataSchema(payload), warnings: Type.Array(Type.String()) }),
      prepareArguments: args => {
        const result = { status: 'ok', data: args?.data, warnings: args?.warnings };
        if (!object(args) || Object.keys(args).some(k => !['data', 'warnings'].includes(k)) ||
          !Array.isArray(args.warnings) || !args.warnings.every(v => typeof v === 'string') ||
          !validateDraft(draftData(args.data), payload, session.snapshot())) {
          // Keep source-aware feedback concise instead of echoing the entire invalid tool arguments.
          throw new Error(feedback(result, payload));
        }
        return args;
      },
      execute: async (_id, args) => {
        if (output !== undefined) return wrap({ accepted: false, code: 'OPERATION_COMPLETE' });
        const result = { status: 'ok', data: draftData(args.data), warnings: args.warnings };
        if (!Array.isArray(args.warnings) || !args.warnings.every(v => typeof v === 'string') ||
          !validateDraft(result.data, payload, session.snapshot())) {
          const canCorrect = reject();
          return wrap({ accepted: false, code: 'INVALID_OUTPUT', remaining_corrections: canCorrect ? 1 : 0,
            ...(canCorrect ? { feedback: feedback(result, payload) } : {}) });
        }
        output = structuredClone(result);
        return wrap({ accepted: true });
      } } };
}
