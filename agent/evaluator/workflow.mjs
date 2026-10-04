/** Adapter for the integration branch's v2 workflow. Native 1.2 reports remain intact. */
import { normalizeRequest, incompleteDraft, error } from './contracts.mjs';
import { runEvaluator, errorResponse, requiredInputResponse } from './runner.mjs';
import { createDeployment } from './deployment.mjs';
import { createModelRuntime } from './models.mjs';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';

const headers = r => Object.fromEntries(['schema_version', 'request_id', 'room_id', 'operation', 'input_revision'].map(k => [k, r[k]]));
const resourceKey = r => JSON.stringify([r.profile_id, r.profile_version, r.item_id, r.member_id]);
const invalid = () => { throw error('INVALID_INPUT', 'Evaluator workflow context does not match approved sources'); };

export function nativeRequest(request, context) {
  const p = request?.payload;
  if (request?.operation !== 'evaluator.evaluate' || p?.contract_version !== '2.0' || !Array.isArray(p.shared_sources)) invalid();
  context ??= { resources: [] };
  if (typeof context !== 'object' || Array.isArray(context) ||
      Object.keys(context).some(k => !['time_limit', 'resources'].includes(k)) || !Array.isArray(context.resources)) invalid();
  const sources = new Map(p.shared_sources.map(s => [s.source_id, s]));
  const resources = context.resources.map(r => {
    const s = sources.get(r.source_id);
    if (Object.keys(r).some(k => !['profile_id','profile_version','item_id','member_id','category','text','source_id'].includes(k)) ||
        !s || s.kind !== 'profile_item' || s.object_ref.id !== r.profile_id || s.object_ref.version !== r.profile_version ||
        s.member_id !== r.member_id || s.text !== r.text) invalid();
    const { source_id, ...item } = r;
    return item;
  });
  const c = p.candidate.content, ref = p.candidate.candidate_ref;
  const traceIds = new Set([...c.discussion_source_ids, ...c.contributions.flatMap(v => v.source_ids)]);
  if ([...traceIds].some(id => !sources.has(id))) invalid();
  const searchCount = p.search_policy.enabled ? Math.min(12, p.search_policy.max_queries) : 0;
  return normalizeRequest({ ...headers(request), payload: {
    candidate: { candidate_id: ref.id, version: ref.version, title: c.title, problem: c.problem,
      target_users: c.target_users, core_flow: [c.solution, ...c.core_flow], mvp_scope: c.mvp_scope,
      out_of_scope: c.out_of_scope, tradeoffs: c.tradeoffs, unknowns: c.unknowns, change_summary: c.change_summary,
      critical_dependencies: c.critical_dependencies.map(d => ({ dependency_id: d.key, description: d.description, must_have: d.must_have })),
      contributions: c.contributions.map(v => ({ description: v.description, origin: v.origin,
        source_refs: context.resources.filter(r => v.source_ids.includes(r.source_id))
          .map(({ profile_id, profile_version, item_id }) => ({ profile_id, profile_version, item_id })) })),
      discussion_trace: [...traceIds].map(id => { const s = sources.get(id); return `${s.kind} (${id}): ${s.text}`; }) },
    room_config: { ...p.room_context, room_id: request.room_id,
      ...(context.time_limit == null ? {} : { time_limit: context.time_limit }),
      constraints: p.room_context.constraints.map(c => ({ id: c.constraint_id, text: c.text,
        source_kind: 'room_constraint', source_id: c.constraint_id,
        verification_status: { supported_by_source: 'documented', team_claim: 'member_reported', unknown: 'unverified' }[c.verification],
        acceptance: c.acceptance === 'confirmed' ? 'team_confirmed' : c.acceptance })) },
    shared_resources: resources,
    tool_budget: { max_searches: searchCount, max_reads: searchCount ? 3 : 0, timeout_ms: 120000, per_call_timeout_ms: 10000 },
  } });
}

/** Exercise the actual Pi tool loop, budget, ledger and submission validator without any network. */
export async function workflowFixture(request) {
  const p = request.payload, draft = incompleteDraft(p);
  for (const t of Object.values(draft.tests)) t.reason = 'OFFLINE FIXTURE: synthetic wiring test; real project merits are unverified.';
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const turns = [];
  for (const scope of ['github', 'devpost'].slice(0, p.tool_budget.max_searches))
    turns.push(fauxAssistantMessage(fauxToolCall('search', { query: 'synthetic fixture project', scope }), { stopReason: 'toolUse' }));
  if (p.tool_budget.max_reads > 0) turns.push(fauxAssistantMessage(fauxToolCall('read_source', { url: 'https://github.com/fixture/team-planner' }), { stopReason: 'toolUse' }));
  turns.push(fauxAssistantMessage(fauxToolCall('submit_report', { data: draft, warnings: ['OFFLINE FIXTURE: no real API calls or completed product checks.'] }), { stopReason: 'toolUse' }));
  faux.setResponses(turns);
  const retrieval = {
    search: async (_q, opts) => ({ results: opts.includeDomains.includes('devpost.com') ? [] :
      [{ url: 'https://github.com/fixture/team-planner', title: 'Synthetic project', content: 'Synthetic discovery lead.' }] }),
    read: async url => ({ url, title: 'Synthetic project', content: 'Synthetic project body; no real evidence.' }),
  };
  const result = await runEvaluator({ request, retrieval, model: faux.getModel(), streamFn: models.streamSimple.bind(models) });
  return result.status === 'error' ? result : { ...result, data: { ...result.data, fixture: true } };
}

export function projectReport(request, context, native, result) {
  if (result.status === 'error') return { response: result, report: null };
  const r = result.data, ref = request.payload.candidate.candidate_ref;
  // Reuse the teammate's deep history validator, including derived fields and evidence shapes.
  normalizeRequest({ ...native, payload: { ...native.payload, previous_report: r } });
  if (r.report_schema_version !== '1.2' || r.candidate_id !== ref.id || r.candidate_version !== ref.version ||
      r.version !== ref.version || r.passed !== Object.values(r.tests).every(t => t.result === 'pass'))
    throw error('INVALID_OUTPUT', 'Evaluator report identity or verdict is invalid');
  const resourceMap = new Map((context?.resources ?? []).map(r => [resourceKey(r), r.source_id]));
  const evidence = [];
  for (const e of r.evidence) {
    // v2 has no honest label for public_web; retain it in the native report instead of relabelling it.
    if (e.source_kind === 'public_web') continue;
    const source_id = e.source_kind === 'member_report' ? resourceMap.get(resourceKey(e.source_ref)) : null;
    if (e.source_kind === 'member_report' && !source_id) throw error('INVALID_OUTPUT', 'Unmatched member evidence');
    evidence.push({ evidence_key: e.evidence_id, url: e.url, title: e.title, accessed_at: e.accessed_at,
      source_kind: e.source_kind === 'member_report' ? 'team_claim' : e.source_kind,
      claim: e.claim, limitation: e.limitation, source_id });
  }
  const allowed = new Set(evidence.map(e => e.evidence_key)), dependencies = new Set(request.payload.candidate.content.critical_dependencies.map(d => d.key));
  const dropped = r.evidence.filter(e => !allowed.has(e.evidence_id));
  const partial = r.status === 'partial' || dropped.length > 0 || r.fixture === true;
  const summary = ['novelty', 'feasibility'].map(k => `${k}: ${r.tests[k].result}. ${r.tests[k].reason}`).join(' ');
  const evaluation = {
    candidate_ref: ref, report_status: partial ? 'partial' : 'complete',
    summary: (r.fixture ? 'OFFLINE FIXTURE. ' : '') + summary,
    findings: r.technical_checks.map((v, i) => ({ finding_key: `finding-${i + 1}`,
      dependency_key: dependencies.has(v.dependency_id) ? v.dependency_id : null,
      finding: `${v.finding} (outcome: ${v.outcome})`,
      conclusion: v.evidence_ids.some(id => !allowed.has(id)) ? 'unknown' : v.conclusion,
      evidence_keys: v.evidence_ids.filter(id => allowed.has(id)), next_check: v.next_check })),
    similar_projects: r.competitors.filter(v => v.evidence_ids.every(id => allowed.has(id))).map(v => ({
      name: v.name, url: v.url, overlap: v.overlap.join('; ') || 'Overlap not established', differences: v.differences.join('; '),
      maturity: v.maturity, evidence_keys: v.evidence_ids })),
    risks: r.risks, unknowns: [...r.unknowns,
      ...dropped.map(e => `Public web source retained in full evaluation_details: ${e.title} (${e.url}). ${e.claim} Limitation: ${e.limitation}`),
      ...r.competitors.filter(v => v.evidence_ids.some(id => !allowed.has(id))).map(v =>
        `Public web comparison (${v.url}): overlap: ${v.overlap.join('; ')}; differences: ${v.differences.join('; ')}; maturity: ${v.maturity}. See full report for source limitations.`)],
    recommended_changes: r.recommended_changes, evidence,
    search_log: r.search_log.filter(v => v.executed !== false).map(v => ({ query: v.query, result_status: v.result_status })),
  };
  return { report: r, response: { ...headers(request), status: partial ? 'partial' : 'ok', error: null,
    data: { contract_version: '2.0', evaluation }, warnings: [...result.warnings,
      ...(dropped.length ? ['Native public_web evidence is retained in evaluation_details; the v2 projection is partial.'] : [])] } };
}

export async function runWorkflowEvaluation({ request, context, offline = false }, { env = process.env, deployment } = {}) {
  try {
    const native = nativeRequest(request, context);
    if (requiredInputResponse(native)) throw error('INVALID_INPUT', 'Project time limit is required before evaluation');
    if (request.payload.provided_evidence.length) throw error('INVALID_INPUT', 'Native evaluator requires current retrieval; provided evidence import is not supported');
    let result;
    if (offline) result = await workflowFixture(native);
    else {
      const provider = env.EVALUATOR_PROVIDER ?? env.PI_PROVIDER ?? 'deepseek';
      const settings = { ...env, EVALUATOR_PROVIDER: provider, EVALUATOR_RETRIEVAL: env.EVALUATOR_RETRIEVAL ?? 'api',
        EVALUATOR_MODEL: env.EVALUATOR_MODEL ?? (provider === 'openai' ? env.OPENAI_MODEL ?? env.PI_MODEL
          : provider === 'gemini' ? undefined : env.DEEPSEEK_MODEL) };
      // Disabled search means no retrieval credentials or requests are needed.
      const runtime = deployment ?? (native.payload.tool_budget.max_searches ? createDeployment(settings) : {
        ...createModelRuntime(settings), retrieval: { search: async () => { throw Error('Retrieval disabled'); }, read: async () => { throw Error('Retrieval disabled'); } } });
      result = await runEvaluator({ request: native, ...runtime });
    }
    return projectReport(request, context, native, result);
  } catch (e) {
    const code = ['INVALID_INPUT', 'CONFIG_ERROR', 'INVALID_OUTPUT'].includes(e?.code) ? e.code : 'MODEL_ERROR';
    return { response: errorResponse(request, code, code === 'MODEL_ERROR' ? 'Evaluator adapter failed' : e.message), report: null };
  }
}
