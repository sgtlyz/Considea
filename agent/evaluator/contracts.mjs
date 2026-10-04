import { randomUUID } from 'node:crypto';

export const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.trim().length > 0;
const strings = x => Array.isArray(x) && x.every(text);
const integer = (x, min = 1) => Number.isSafeInteger(x) && x >= min;
const keys = (x, allowed) => object(x) && Object.keys(x).every(k => allowed.includes(k));
const unique = xs => new Set(xs).size === xs.length;
const sourceRef = v => keys(v, ['profile_id', 'profile_version', 'item_id']) && text(v.profile_id) && integer(v.profile_version) && text(v.item_id);
const testShape = t => keys(t, ['result', 'reason', 'evidence_ids', 'required_changes', 'missing_information']) &&
  ['pass', 'fail', 'insufficient_evidence'].includes(t.result) && text(t.reason) && strings(t.evidence_ids) &&
  strings(t.required_changes) && strings(t.missing_information);

/** Historical reports are untrusted planning input; never allow arbitrary nested payloads into the model. */
function validHistory(r) {
  if (!keys(r, ['report_schema_version', 'report_id', 'candidate_id', 'candidate_version', 'status', 'passed', 'tests',
    'competitors', 'technical_checks', 'risks', 'unverified_assumptions', 'recommended_changes', 'evidence', 'search_log'])) return false;
  for (const k of ['report_schema_version', 'report_id', 'candidate_id']) if (r[k] !== undefined && !text(r[k])) return false;
  if ((r.candidate_version !== undefined && !integer(r.candidate_version)) ||
    (r.passed !== undefined && typeof r.passed !== 'boolean') ||
    (r.status !== undefined && !['complete', 'partial'].includes(r.status))) return false;
  for (const k of ['risks', 'unverified_assumptions', 'recommended_changes']) if (r[k] !== undefined && !strings(r[k])) return false;
  if (r.tests !== undefined && (!keys(r.tests, ['novelty', 'feasibility']) || !Object.values(r.tests).every(testShape))) return false;
  if (r.competitors !== undefined && (!Array.isArray(r.competitors) || !r.competitors.every(v =>
    keys(v, ['name', 'url', 'overlap', 'differences', 'maturity', 'evidence_ids']) && text(v.name) && text(v.url) &&
    strings(v.overlap) && strings(v.differences) && strings(v.evidence_ids) &&
    ['self_reported_implemented', 'planned', 'unknown'].includes(v.maturity)))) return false;
  if (r.technical_checks !== undefined && (!Array.isArray(r.technical_checks) || !r.technical_checks.every(v =>
    keys(v, ['dependency_id', 'finding', 'conclusion', 'evidence_ids', 'next_check']) && text(v.dependency_id) && text(v.finding) &&
    ['documented_support', 'documented_blocker', 'member_reported', 'unknown'].includes(v.conclusion) &&
    strings(v.evidence_ids) && typeof v.next_check === 'string'))) return false;
  if (r.search_log !== undefined && (!Array.isArray(r.search_log) || !r.search_log.every(v =>
    keys(v, ['query', 'result_status', 'error_code']) && text(v.query) && ['results', 'no_results', 'failed'].includes(v.result_status) &&
    (v.error_code === undefined || text(v.error_code))))) return false;
  if (r.evidence !== undefined && (!Array.isArray(r.evidence) || !r.evidence.every(v =>
    keys(v, ['evidence_id', 'url', 'title', 'accessed_at', 'source_kind', 'claim', 'limitation', 'excerpt', 'source_ref']) &&
    ['evidence_id', 'title', 'accessed_at', 'limitation'].every(k => text(v[k])) && (v.url === null || text(v.url)) &&
    ['official_documentation', 'project_self_report', 'member_report'].includes(v.source_kind) &&
    (v.claim === undefined || text(v.claim)) && (v.excerpt === undefined || text(v.excerpt)) &&
    (v.source_ref === undefined || (keys(v.source_ref, ['profile_id', 'profile_version', 'item_id', 'member_id']) &&
      text(v.source_ref.profile_id) && integer(v.source_ref.profile_version) && text(v.source_ref.item_id) && text(v.source_ref.member_id)))))) return false;
  return true;
}
export const error = (code, message) => Object.assign(new Error(message), { code });
export const DEFAULT_BUDGET = Object.freeze({ max_searches: 2, max_reads: 3, timeout_ms: 60000, per_call_timeout_ms: 10000 });
export const HARD_BUDGET = Object.freeze({ max_searches: 12, max_reads: 12, timeout_ms: 180000, per_call_timeout_ms: 30000 });

export function normalizeRequest(request) {
  const invalid = () => { throw error('INVALID_INPUT', 'Invalid evaluator input; see Evaluator README for the contract'); };
  if (!object(request) || request.schema_version !== '1.0' ||
    !['request_id', 'room_id'].every(k => text(request[k])) || !integer(request.input_revision, 0) ||
    !['evaluator.evaluate', 'evaluator.investigate'].includes(request.operation)) invalid();
  const p = structuredClone(request.payload);
  if (!keys(p, ['idea', 'candidate', 'room_config', 'team_criteria', 'shared_resources', 'previous_report', 'tool_budget', 'question']) ||
    Boolean(p.idea) === Boolean(p.candidate)) invalid();
  if (p.idea) {
    p.candidate = { candidate_id: randomUUID(), version: 1, iteration_index: 1, out_of_scope: [],
      contributions: [], tradeoffs: [], unknowns: [], change_summary: '', ...p.idea };
    delete p.idea;
  }
  const c = p.candidate;
  if (!keys(c, ['candidate_id', 'version', 'iteration_index', 'title', 'target_users', 'problem', 'core_flow',
    'mvp_scope', 'out_of_scope', 'critical_dependencies', 'contributions', 'tradeoffs', 'unknowns', 'change_summary']) ||
    !['candidate_id', 'title', 'problem'].every(k => text(c[k])) || !integer(c.version) || !integer(c.iteration_index) ||
    !['target_users', 'core_flow', 'mvp_scope'].every(k => strings(c[k]) && c[k].length > 0) ||
    !['out_of_scope', 'tradeoffs', 'unknowns'].every(k => strings(c[k])) || typeof c.change_summary !== 'string' ||
    !Array.isArray(c.critical_dependencies) || !c.critical_dependencies.every(d =>
      keys(d, ['dependency_id', 'description', 'must_have']) && text(d.dependency_id) && text(d.description) && typeof d.must_have === 'boolean') ||
    !unique(c.critical_dependencies.map(d => d.dependency_id)) || !Array.isArray(c.contributions) ||
    !c.contributions.every(v => keys(v, ['description', 'source_refs', 'origin']) && text(v.description) && ['member_input', 'agent_synthesis'].includes(v.origin) &&
      Array.isArray(v.source_refs) && v.source_refs.every(sourceRef))) invalid();
  const room = p.room_config;
  if (!keys(room, ['room_id', 'member_ids', 'deadline_at', 'max_iterations', 'initial_interview_max_rounds', 'max_questions_per_turn',
    'followup_batches_per_member_per_iteration', 'constraints']) || room.room_id !== request.room_id || !strings(room.member_ids) || !unique(room.member_ids) ||
    !integer(room.max_iterations) || !integer(room.initial_interview_max_rounds) || !integer(room.max_questions_per_turn) ||
    !integer(room.followup_batches_per_member_per_iteration, 0) ||
    !(room.deadline_at === null || (text(room.deadline_at) && /(?:Z|[+-]\d{2}:\d{2})$/.test(room.deadline_at) && Number.isFinite(Date.parse(room.deadline_at)))) ||
    !Array.isArray(room.constraints) || !room.constraints.every(v => keys(v, ['id', 'text', 'source_kind', 'source_id', 'verification_status', 'acceptance']) && text(v.id) && text(v.text) &&
      text(v.source_kind) && text(v.source_id) && ['documented', 'member_reported', 'unverified'].includes(v.verification_status) &&
      ['team_confirmed', 'proposed', 'disputed'].includes(v.acceptance))) invalid();
  const t = p.team_criteria;
  if (!keys(t, ['version', 'criteria', 'unresolved_tradeoffs']) || !integer(t.version) || !strings(t.unresolved_tradeoffs) || !Array.isArray(t.criteria) ||
    !t.criteria.every(v => keys(v, ['id', 'text', 'member_source_refs', 'acceptance']) && text(v.id) && text(v.text) && Array.isArray(v.member_source_refs) && v.member_source_refs.every(sourceRef) &&
      ['team_confirmed', 'proposed', 'disputed'].includes(v.acceptance))) invalid();
  if (!Array.isArray(p.shared_resources) || !p.shared_resources.every(v =>
    keys(v, ['profile_id', 'profile_version', 'item_id', 'member_id', 'category', 'text']) && text(v.profile_id) &&
    integer(v.profile_version) && text(v.item_id) && room.member_ids.includes(v.member_id) &&
    ['skill', 'resource'].includes(v.category) && text(v.text)) ||
    !unique(p.shared_resources.map(v => `${v.profile_id}:${v.profile_version}:${v.item_id}`)) ||
    !(p.previous_report === null || validHistory(p.previous_report))) invalid();
  if (p.tool_budget !== undefined && !keys(p.tool_budget, Object.keys(DEFAULT_BUDGET))) invalid();
  p.tool_budget = { ...DEFAULT_BUDGET, ...p.tool_budget };
  if (!Object.entries(p.tool_budget).every(([k, v]) => integer(v, k.startsWith('max_') ? 0 : 1) && v <= HARD_BUDGET[k]) ||
    p.tool_budget.per_call_timeout_ms > p.tool_budget.timeout_ms) invalid();
  if (request.operation === 'evaluator.investigate' && (!keys(p.question, ['issue_id', 'text', 'expected_information']) ||
    !['issue_id', 'text', 'expected_information'].every(k => text(p.question[k])))) invalid();
  if (request.operation === 'evaluator.evaluate' && p.question !== undefined) invalid();
  return { ...request, payload: p };
}

export function validateDraft(d, p, ledger) {
  const sources = new Map(ledger.evidence.map(e => [e.evidence_id, e]));
  const refs = (xs, require = false, kind) => strings(xs) && unique(xs) && (!require || xs.length > 0) &&
    xs.every(id => sources.has(id) && (!kind || sources.get(id).source_kind === kind));
  const conclusion = v => ['documented_support', 'documented_blocker', 'member_reported', 'unknown'].includes(v.conclusion) &&
    refs(v.evidence_ids, v.conclusion !== 'unknown', v.conclusion.startsWith('documented_') ? 'official_documentation' :
      v.conclusion === 'member_reported' ? 'member_report' : undefined);
  if (!object(d) || d.candidate_id !== p.candidate.candidate_id || d.candidate_version !== p.candidate.version) return false;
  if (p.question) return keys(d, ['issue_id', 'candidate_id', 'candidate_version', 'answer', 'conclusion', 'evidence_ids', 'limitations', 'recommended_next_step']) &&
    d.issue_id === p.question.issue_id && text(d.answer) && conclusion(d) && strings(d.limitations) && text(d.recommended_next_step);
  if (!keys(d, ['candidate_id', 'candidate_version', 'tests', 'competitors', 'technical_checks', 'risks', 'unverified_assumptions', 'recommended_changes']) ||
    !keys(d.tests, ['novelty', 'feasibility']) || !['novelty', 'feasibility'].every(k => {
      const t = d.tests[k]; return keys(t, ['result', 'reason', 'evidence_ids', 'required_changes', 'missing_information']) &&
        ['pass', 'fail', 'insufficient_evidence'].includes(t.result) && text(t.reason) && refs(t.evidence_ids) &&
        strings(t.required_changes) && strings(t.missing_information) &&
        (t.result !== 'fail' || t.evidence_ids.length > 0) &&
        (t.result !== 'insufficient_evidence' || t.missing_information.length > 0);
    }) || !['risks', 'unverified_assumptions', 'recommended_changes'].every(k => strings(d[k]))) return false;
  if (!Array.isArray(d.competitors) || d.competitors.length > 3 || !d.competitors.every(v =>
    keys(v, ['name', 'url', 'overlap', 'differences', 'maturity', 'evidence_ids']) && text(v.name) && strings(v.overlap) && strings(v.differences) &&
    ['self_reported_implemented', 'planned', 'unknown'].includes(v.maturity) && refs(v.evidence_ids, true) &&
    v.evidence_ids.some(id => sources.get(id).url === v.url))) return false;
  const hasProjectEvidence = d.competitors.some(v => v.evidence_ids.some(id =>
    d.tests.novelty.evidence_ids.includes(id) && sources.get(id).url !== null));
  if (d.tests.novelty.result === 'fail' && !hasProjectEvidence) return false;
  if (d.tests.novelty.result === 'pass' && !hasProjectEvidence &&
    !ledger.search_log.some(v => v.result_status === 'no_results')) return false;
  const deps = p.candidate.critical_dependencies;
  if (!Array.isArray(d.technical_checks) || d.technical_checks.length !== deps.length ||
    !d.technical_checks.every(object) || !unique(d.technical_checks.map(v => v.dependency_id)) || !d.technical_checks.every(v =>
      keys(v, ['dependency_id', 'finding', 'conclusion', 'evidence_ids', 'next_check']) && deps.some(dep => dep.dependency_id === v.dependency_id) &&
      text(v.finding) && typeof v.next_check === 'string' && conclusion(v))) return false;
  if (d.tests.novelty.result === 'pass' && !ledger.search_log.some(v => ['results', 'no_results'].includes(v.result_status))) return false;
  if (d.tests.feasibility.result === 'pass' && (p.shared_resources.length === 0 ||
    !(p.room_config.deadline_at || p.room_config.constraints.some(v => v.acceptance === 'team_confirmed')) ||
    deps.some(dep => dep.must_have && !d.technical_checks.some(v => v.dependency_id === dep.dependency_id &&
      ['documented_support', 'member_reported'].includes(v.conclusion))))) return false;
  return true;
}

export function finalizeReport(draft, p, ledger) {
  const d = structuredClone(draft);
  const evidence = ledger.evidence.map(e => ({ ...e, claim: [d.evidence_ids?.includes(e.evidence_id) ? d.answer : undefined,
    ...Object.values(d.tests ?? {}).filter(t => t.evidence_ids.includes(e.evidence_id)).map(t => t.reason),
    ...(d.technical_checks ?? []).filter(t => t.evidence_ids.includes(e.evidence_id)).map(t => t.finding)]
    .filter(Boolean).join('；').slice(0, 1000) || '实际读取的来源；未用于完成结论。' }));
  if (p.question) return { ...d, evidence, search_log: structuredClone(ledger.search_log) };
  if (ledger.incomplete) for (const t of Object.values(d.tests)) if (t.result === 'pass') {
    t.result = 'insufficient_evidence'; t.reason = '检索未完整结束；尚未核实是否通过。';
    t.missing_information.push('完成失败或未执行的检索检查');
  }
  return { report_schema_version: '1.1', report_id: randomUUID(), ...d,
    candidate_id: p.candidate.candidate_id, candidate_version: p.candidate.version,
    passed: d.tests.novelty.result === 'pass' && d.tests.feasibility.result === 'pass',
    status: ledger.incomplete ? 'partial' : 'complete', evidence, search_log: structuredClone(ledger.search_log) };
}

export function incompleteDraft(p) {
  if (p.question) return { issue_id: p.question.issue_id, candidate_id: p.candidate.candidate_id,
    candidate_version: p.candidate.version, answer: '本次调查未完成，尚未核实。', conclusion: 'unknown',
    evidence_ids: [], limitations: ['运行或检索预算已耗尽'], recommended_next_step: '补充证据后重试' };
  const test = () => ({ result: 'insufficient_evidence', reason: '本次调查未完成，尚未核实。',
    evidence_ids: [], required_changes: [], missing_information: ['完成查重与可行性检查'] });
  return { candidate_id: p.candidate.candidate_id, candidate_version: p.candidate.version,
    tests: { novelty: test(), feasibility: test() }, competitors: [],
    technical_checks: p.candidate.critical_dependencies.map(dep => ({ dependency_id: dep.dependency_id,
      finding: '尚未完成核实', conclusion: 'unknown', evidence_ids: [], next_check: '核实依赖能力与访问条件' })),
    risks: [], unverified_assumptions: ['调查未完成'], recommended_changes: [] };
}
