import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { noveltyCoverage, missingNoveltyChecks, isScopedProjectUrl } from './novelty.mjs';

export const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.trim().length > 0;
const strings = x => Array.isArray(x) && x.every(text);
const integer = (x, min = 1) => Number.isSafeInteger(x) && x >= min;
const keys = (x, allowed) => object(x) && Object.keys(x).every(k => allowed.includes(k));
const unique = xs => new Set(xs).size === xs.length;
const timestamp = value => {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const validTimeLimit = v => object(v) && (
  (keys(v, ['kind']) && v.kind === 'none') ||
  (keys(v, ['kind', 'hours']) && v.kind === 'duration' && typeof v.hours === 'number' && Number.isFinite(v.hours) && v.hours > 0) ||
  (keys(v, ['kind', 'deadline_at']) && v.kind === 'deadline' && timestamp(v.deadline_at)));
const sourceRef = v => keys(v, ['profile_id', 'profile_version', 'item_id']) && text(v.profile_id) && integer(v.profile_version) && text(v.item_id);
const testShape = t => keys(t, ['result', 'reason', 'evidence_ids', 'required_changes', 'missing_information']) &&
  ['pass', 'fail', 'insufficient_evidence'].includes(t.result) && text(t.reason) && strings(t.evidence_ids) &&
  strings(t.required_changes) && strings(t.missing_information);

/** Historical reports are untrusted planning input; never allow arbitrary nested payloads into the model. */
function validHistory(r) {
  if (r?.report_schema_version === '1.2') {
    // New display fields must exactly match the validated report, including all nested source fields.
    const { version, feasibility, similar_projects, unknowns, sources, ...legacy } = r;
    if (!Array.isArray(legacy.technical_checks)) return false;
    const originalChecks = legacy.technical_checks;
    legacy.technical_checks = originalChecks.map(v => {
      if (!keys(v, ['dependency_id', 'finding', 'conclusion', 'outcome', 'evidence_ids', 'next_check', 'next_check_status'])) return null;
      const { outcome, next_check_status, ...check } = v;
      const conclusion = v.conclusion === 'supported_by_source' && ['support', 'blocker'].includes(outcome) ? `documented_${outcome}` :
        v.conclusion === 'team_claim' && outcome === 'support' ? 'member_reported' :
        v.conclusion === 'unknown' && outcome === 'unknown' ? 'unknown' : null;
      if (!conclusion || next_check_status !== 'needs_test') return null;
      return { ...check, conclusion };
    });
    legacy.report_schema_version = '1.1';
    if (!validHistory(legacy) || !legacy.tests?.novelty || !legacy.tests?.feasibility ||
      !Array.isArray(legacy.evidence) || !Array.isArray(legacy.competitors) || !Array.isArray(legacy.unverified_assumptions)) return false;
    const projected = workflowFields(legacy, legacy.evidence ?? []);
    return version === legacy.candidate_version && isDeepStrictEqual(feasibility, projected.feasibility) &&
      isDeepStrictEqual(similar_projects, projected.similar_projects) && isDeepStrictEqual(unknowns, projected.unknowns) &&
      isDeepStrictEqual(sources, projected.sources) && isDeepStrictEqual(originalChecks, projected.technical_checks);
  }
  if (!keys(r, ['report_schema_version', 'report_id', 'candidate_id', 'candidate_version', 'status', 'passed', 'tests',
    'competitors', 'technical_checks', 'risks', 'unverified_assumptions', 'recommended_changes', 'evidence', 'search_log', 'novelty_coverage', 'fixture'])) return false;
  for (const k of ['report_schema_version', 'report_id', 'candidate_id']) if (r[k] !== undefined && !text(r[k])) return false;
  if ((r.candidate_version !== undefined && !integer(r.candidate_version)) ||
    (r.passed !== undefined && typeof r.passed !== 'boolean') ||
    (r.status !== undefined && !['complete', 'partial'].includes(r.status)) ||
    (r.fixture !== undefined && r.fixture !== true)) return false;
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
    keys(v, ['query', 'result_status', 'error_code', 'scope', 'executed', 'result_count', 'excluded_count', 'result_urls']) &&
    text(v.query) && ['results', 'no_results', 'failed'].includes(v.result_status) &&
    (v.error_code === undefined || text(v.error_code)) && (v.scope === undefined || ['github', 'devpost', 'web'].includes(v.scope)) &&
    (v.executed === undefined || typeof v.executed === 'boolean') &&
    ['result_count', 'excluded_count'].every(k => v[k] === undefined || integer(v[k], 0)) &&
    (v.result_urls === undefined || strings(v.result_urls))))) return false;
  if (r.novelty_coverage !== undefined && !isDeepStrictEqual(r.novelty_coverage, noveltyCoverage(r.search_log))) return false;
  if (r.evidence !== undefined && (!Array.isArray(r.evidence) || !r.evidence.every(v =>
    keys(v, ['evidence_id', 'url', 'title', 'accessed_at', 'source_kind', 'claim', 'limitation', 'excerpt', 'source_ref']) &&
    ['evidence_id', 'title', 'accessed_at', 'limitation'].every(k => text(v[k])) && (v.url === null || text(v.url)) &&
    ['official_documentation', 'public_web', 'project_self_report', 'member_report'].includes(v.source_kind) &&
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
    p.candidate = { candidate_id: randomUUID(), version: 1, ...p.idea };
    delete p.idea;
  }
  if (object(p.candidate) && ['target_user', 'solution', 'mvp'].some(k => k in p.candidate)) {
    const v = p.candidate;
    if (!keys(v, ['candidate_id', 'version', 'title', 'target_user', 'problem', 'solution', 'discussion_trace', 'tradeoffs',
      'mvp', 'member_suggestions', 'status', 'critical_dependencies', 'why_team', 'key_tradeoffs', 'open_questions']) ||
      !['target_user', 'solution'].every(k => text(v[k])) ||
      !(text(v.mvp) || (strings(v.mvp) && v.mvp.length > 0)) ||
      ['discussion_trace', 'tradeoffs', 'member_suggestions', 'key_tradeoffs', 'open_questions'].some(k => v[k] !== undefined && !strings(v[k])) ||
      ['status', 'why_team'].some(k => v[k] !== undefined && !text(v[k]))) invalid();
    p.candidate = { candidate_id: v.candidate_id, version: v.version, title: v.title, problem: v.problem,
      target_users: [v.target_user], core_flow: [v.solution], mvp_scope: Array.isArray(v.mvp) ? v.mvp : [v.mvp],
      critical_dependencies: v.critical_dependencies ?? [], tradeoffs: v.tradeoffs ?? v.key_tradeoffs ?? [],
      unknowns: v.open_questions ?? [], discussion_trace: v.discussion_trace ?? [], member_suggestions: v.member_suggestions ?? [],
      ...(v.status === undefined ? {} : { status: v.status }), ...(v.why_team === undefined ? {} : { why_team: v.why_team }) };
  }
  // Keep the original Pi data shape internally; newer workflow fields survive as approved summaries.
  p.candidate = { iteration_index: 1, out_of_scope: [], contributions: [], tradeoffs: [], unknowns: [], change_summary: '', ...p.candidate };
  const c = p.candidate;
  if (!keys(c, ['candidate_id', 'version', 'iteration_index', 'title', 'target_users', 'problem', 'core_flow',
    'mvp_scope', 'out_of_scope', 'critical_dependencies', 'contributions', 'tradeoffs', 'unknowns', 'change_summary',
    'discussion_trace', 'member_suggestions', 'status', 'why_team']) ||
    !['candidate_id', 'title', 'problem'].every(k => text(c[k])) || !integer(c.version) || !integer(c.iteration_index) ||
    !['target_users', 'core_flow', 'mvp_scope'].every(k => strings(c[k]) && c[k].length > 0) ||
    !['out_of_scope', 'tradeoffs', 'unknowns'].every(k => strings(c[k])) || typeof c.change_summary !== 'string' ||
    !Array.isArray(c.critical_dependencies) || !c.critical_dependencies.every(d =>
      keys(d, ['dependency_id', 'description', 'must_have']) && text(d.dependency_id) && text(d.description) && typeof d.must_have === 'boolean') ||
    !unique(c.critical_dependencies.map(d => d.dependency_id)) || !Array.isArray(c.contributions) ||
    !c.contributions.every(v => keys(v, ['description', 'source_refs', 'origin']) && text(v.description) && ['member_input', 'agent_synthesis'].includes(v.origin) &&
      Array.isArray(v.source_refs) && v.source_refs.every(sourceRef)) ||
    ['discussion_trace', 'member_suggestions'].some(k => c[k] !== undefined && !strings(c[k])) ||
    ['status', 'why_team'].some(k => c[k] !== undefined && !text(c[k]))) invalid();
  const room = p.room_config;
  if (!keys(room, ['room_id', 'members', 'member_ids', 'deadline_at', 'time_limit', 'max_iterations', 'initial_interview_max_rounds', 'max_questions_per_turn',
    'followup_batches_per_member_per_iteration', 'constraints', 'hackathon_context', 'discussion_round_limit', 'idea_candidate_limit', 'status']) ||
    (room.members !== undefined && room.member_ids !== undefined)) invalid();
  room.member_ids = room.member_ids ?? room.members; delete room.members;
  room.deadline_at ??= null; room.constraints ??= [];
  if (room.room_id !== request.room_id || !strings(room.member_ids) || !unique(room.member_ids) ||
    ['max_iterations', 'initial_interview_max_rounds', 'max_questions_per_turn', 'discussion_round_limit', 'idea_candidate_limit']
      .some(k => room[k] !== undefined && !integer(room[k])) ||
    (room.followup_batches_per_member_per_iteration !== undefined && !integer(room.followup_batches_per_member_per_iteration, 0)) ||
    ['hackathon_context', 'status'].some(k => room[k] !== undefined && !text(room[k])) ||
    !(room.deadline_at === null || timestamp(room.deadline_at)) ||
    (room.time_limit !== undefined && !validTimeLimit(room.time_limit)) ||
    (room.deadline_at !== null && room.time_limit !== undefined &&
      (room.time_limit.kind !== 'deadline' || room.time_limit.deadline_at !== room.deadline_at)) ||
    !Array.isArray(room.constraints) || !room.constraints.every(v => text(v) || (keys(v, ['id', 'text', 'source_kind', 'source_id', 'verification_status', 'acceptance']) && text(v.id) && text(v.text) &&
      text(v.source_kind) && text(v.source_id) && ['documented', 'member_reported', 'unverified'].includes(v.verification_status) &&
      ['team_confirmed', 'proposed', 'disputed'].includes(v.acceptance)))) invalid();
  if (room.time_limit === undefined && room.deadline_at !== null) room.time_limit = { kind: 'deadline', deadline_at: room.deadline_at };
  p.team_criteria ??= { version: 1, criteria: [], unresolved_tradeoffs: [] };
  p.shared_resources ??= []; p.previous_report ??= null;
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

export function isProjectListingUrl(value) {
  try {
    const u = new URL(value);
    return (['github.com', 'www.github.com'].includes(u.hostname) && !isScopedProjectUrl(value, 'github')) ||
      (['devpost.com', 'www.devpost.com'].includes(u.hostname) && !isScopedProjectUrl(value, 'devpost')) ||
      (u.hostname.endsWith('.devpost.com') && !['devpost.com', 'www.devpost.com'].includes(u.hostname));
  } catch { return false; }
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
  if (p.tool_budget.max_searches > 0 && ledger.search_log.length === 0) return false;
  const coverage = noveltyCoverage(ledger.search_log);
  // Require distinct actual platform attempts within the supplied budget; never fabricate a second search.
  if (coverage.scopes.filter(v => v.attempts > 0).length < Math.min(2, p.tool_budget.max_searches)) return false;
  if (!keys(d, ['candidate_id', 'candidate_version', 'tests', 'competitors', 'technical_checks', 'risks', 'unverified_assumptions', 'recommended_changes']) ||
    !keys(d.tests, ['novelty', 'feasibility']) || !['novelty', 'feasibility'].every(k => {
      const t = d.tests[k]; return keys(t, ['result', 'reason', 'evidence_ids', 'required_changes', 'missing_information']) &&
        ['pass', 'fail', 'insufficient_evidence'].includes(t.result) && text(t.reason) && refs(t.evidence_ids) &&
        strings(t.required_changes) && strings(t.missing_information) &&
        (t.result !== 'fail' || t.evidence_ids.length > 0) &&
        (t.result !== 'insufficient_evidence' || t.missing_information.length > 0);
    }) || !['risks', 'unverified_assumptions', 'recommended_changes'].every(k => strings(d[k]))) return false;
  if (!Array.isArray(d.competitors) || d.competitors.length > 3 || !d.competitors.every(v =>
    keys(v, ['name', 'url', 'overlap', 'differences', 'maturity', 'evidence_ids']) && text(v.name) && text(v.url) && !isProjectListingUrl(v.url) && strings(v.overlap) && strings(v.differences) &&
    ['self_reported_implemented', 'planned', 'unknown'].includes(v.maturity) && refs(v.evidence_ids, true) &&
    v.evidence_ids.some(id => sources.get(id).url === v.url && sources.get(id).source_kind !== 'member_report'))) return false;
  const hasProjectEvidence = d.competitors.some(v => v.evidence_ids.some(id =>
    d.tests.novelty.evidence_ids.includes(id) && sources.get(id).url !== null));
  if (d.tests.novelty.result === 'fail' && !hasProjectEvidence) return false;
  if (d.tests.novelty.result === 'pass' && (!coverage.complete || (!hasProjectEvidence &&
    !coverage.scopes.every(v => v.status === 'no_results')))) return false;
  const deps = p.candidate.critical_dependencies;
  if (!Array.isArray(d.technical_checks) || !deps.every(dep => d.technical_checks.some(v => v?.dependency_id === dep.dependency_id)) ||
    !d.technical_checks.every(object) || !unique(d.technical_checks.map(v => v.dependency_id)) || !d.technical_checks.every(v =>
      keys(v, ['dependency_id', 'finding', 'conclusion', 'evidence_ids', 'next_check']) && text(v.dependency_id) &&
      text(v.finding) && typeof v.next_check === 'string' && conclusion(v))) return false;
  if (d.tests.novelty.result === 'pass' && !ledger.search_log.some(v => ['results', 'no_results'].includes(v.result_status))) return false;
  if (d.tests.feasibility.result === 'pass' && (p.shared_resources.length === 0 ||
    !validTimeLimit(p.room_config.time_limit) || d.technical_checks.length === 0 ||
    d.technical_checks.some(v => {
      const dep = deps.find(dep => dep.dependency_id === v.dependency_id);
      if (dep?.must_have === false) return false;
      if (!['documented_support', 'member_reported'].includes(v.conclusion)) return true;
      // Skills can support a team-skill check, but cannot establish access to an input API/data/device dependency.
      return dep && v.conclusion === 'member_reported' && !v.evidence_ids.some(id => {
        const ref = sources.get(id).source_ref;
        return ref && p.shared_resources.some(item => item.category === 'resource' && item.profile_id === ref.profile_id &&
          item.profile_version === ref.profile_version && item.item_id === ref.item_id && item.member_id === ref.member_id);
      });
    }))) return false;
  return true;
}

const evidenceLevel = kind => kind === 'member_report' ? 'team_claim' : 'supported_by_source';
function workflowFields(d, evidence) {
  return { version: d.candidate_version,
    feasibility: [{ ...d.tests.feasibility, conclusion: d.tests.feasibility.result === 'insufficient_evidence' ||
      d.tests.feasibility.evidence_ids.length === 0 ? 'unknown' :
      d.tests.feasibility.evidence_ids.some(id => evidence.find(e => e.evidence_id === id)?.source_kind !== 'member_report') ?
        'supported_by_source' : 'team_claim' }],
    similar_projects: d.competitors.map(v => ({ ...v, conclusion: 'supported_by_source' })),
    technical_checks: d.technical_checks.map(v => ({ ...v,
      conclusion: v.conclusion.startsWith('documented_') ? 'supported_by_source' : v.conclusion === 'member_reported' ? 'team_claim' : 'unknown',
      outcome: v.conclusion === 'documented_blocker' ? 'blocker' : v.conclusion === 'unknown' ? 'unknown' : 'support',
      next_check_status: 'needs_test' })),
    unknowns: [...new Set([...d.unverified_assumptions, ...Object.values(d.tests).flatMap(t => t.missing_information),
      ...d.technical_checks.filter(v => v.conclusion === 'unknown').map(v => `${v.dependency_id}: ${v.finding}`)])],
    sources: evidence.map(e => ({ ...e, conclusion: evidenceLevel(e.source_kind) })) };
}

export function finalizeReport(draft, p, ledger) {
  const d = structuredClone(draft);
  const evidence = ledger.evidence.map(e => ({ ...e, claim: [d.evidence_ids?.includes(e.evidence_id) ? d.answer : undefined,
    ...Object.values(d.tests ?? {}).filter(t => t.evidence_ids.includes(e.evidence_id)).map(t => t.reason),
    ...(d.technical_checks ?? []).filter(t => t.evidence_ids.includes(e.evidence_id)).map(t => t.finding)]
    .filter(Boolean).join('; ').slice(0, 1000) || 'Actual source record; not used in a completed conclusion.' }));
  if (p.question) return { ...d, version: d.candidate_version,
    conclusion: d.conclusion.startsWith('documented_') ? 'supported_by_source' : d.conclusion === 'member_reported' ? 'team_claim' : 'unknown',
    outcome: d.conclusion === 'documented_blocker' ? 'blocker' : d.conclusion === 'unknown' ? 'unknown' : 'support',
    sources: evidence.map(e => ({ ...e, conclusion: evidenceLevel(e.source_kind) })),
    next_check_status: 'needs_test', evidence, search_log: structuredClone(ledger.search_log) };
  if (ledger.incomplete) for (const t of Object.values(d.tests)) if (t.result === 'pass') {
    t.result = 'insufficient_evidence'; t.reason = 'Retrieval did not complete; a pass has not been established.';
    t.missing_information.push('Complete failed or unperformed retrieval checks');
  }
  const coverage = noveltyCoverage(ledger.search_log);
  if (!coverage.complete) {
    if (d.tests.novelty.result === 'pass') {
      d.tests.novelty.result = 'insufficient_evidence';
      d.tests.novelty.reason = 'The required GitHub and Devpost project searches have not both completed successfully.';
    }
    d.tests.novelty.missing_information = [...new Set([...d.tests.novelty.missing_information, ...missingNoveltyChecks(coverage)])];
  }
  return { report_schema_version: '1.2', report_id: randomUUID(), ...d,
    candidate_id: p.candidate.candidate_id, candidate_version: p.candidate.version,
    passed: d.tests.novelty.result === 'pass' && d.tests.feasibility.result === 'pass',
    status: ledger.incomplete || !coverage.complete ? 'partial' : 'complete', evidence, search_log: structuredClone(ledger.search_log),
    novelty_coverage: coverage,
    ...workflowFields(d, evidence) };
}

export function incompleteDraft(p) {
  if (p.question) return { issue_id: p.question.issue_id, candidate_id: p.candidate.candidate_id,
    candidate_version: p.candidate.version, answer: 'Investigation is incomplete; the requested claim is unverified.', conclusion: 'unknown',
    evidence_ids: [], limitations: ['Runtime or retrieval budget exhausted'], recommended_next_step: 'Obtain missing evidence and retry' };
  const test = () => ({ result: 'insufficient_evidence', reason: 'Assessment is incomplete; the result is unverified.',
    evidence_ids: [], required_changes: [], missing_information: ['Complete novelty and feasibility checks'] });
  return { candidate_id: p.candidate.candidate_id, candidate_version: p.candidate.version,
    tests: { novelty: test(), feasibility: test() }, competitors: [],
    technical_checks: p.candidate.critical_dependencies.map(dep => ({ dependency_id: dep.dependency_id,
      finding: 'Not yet verified', conclusion: 'unknown', evidence_ids: [], next_check: 'Check dependency capabilities and access requirements' })),
    risks: [], unverified_assumptions: ['Assessment incomplete'], recommended_changes: [] };
}
