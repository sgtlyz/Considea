import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRequest, validateDraft, finalizeReport } from '../contracts.mjs';
import { request, draft, source, idea, investigation } from './fixtures.mjs';
const scopedSearch = (scope, result_status = 'results') => ({ scope, executed: true,
  query: `site:${scope === 'github' ? 'github.com' : 'devpost.com/software'} team decision workflow`,
  result_status, result_count: result_status === 'results' ? 1 : 0, excluded_count: 0,
  result_urls: result_status === 'results' ? [scope === 'github' ? 'https://github.com/example/team-planner' :
    'https://devpost.com/software/team-planner'] : [] });
const ledger = { evidence: [source], search_log: ['github', 'devpost'].map(scope => scopedSearch(scope)), incomplete: false };

test('accepts detailed idea and normalizes it to workflow candidate', () => {
  const r = request(); delete r.payload.candidate; r.payload.idea = { ...idea };
  const n = normalizeRequest(r); assert.equal(n.payload.candidate.candidate_id, 'idea-1');
  assert.equal(n.payload.idea, undefined); assert.equal(n.payload.tool_budget.max_reads, 3);
});
test('rejects missing idea fields, private messages, mismatched rooms and invalid budgets', () => {
  for (const mutate of [r => delete r.payload.candidate.problem, r => r.payload.messages = [],
    r => r.payload.room_config.room_id = 'other', r => r.payload.tool_budget.max_searches = -1,
    r => r.payload.tool_budget.timeout_ms = 0, r => r.payload.candidate.critical_dependencies.push(r.payload.candidate.critical_dependencies[0])]) {
    const r = request(); mutate(r); assert.throws(() => normalizeRequest(r), { code: 'INVALID_INPUT' });
  }
});
test('enforces source identity, dependency coverage and official technical conclusions', () => {
  assert.equal(validateDraft(draft(), request().payload, ledger), true);
  for (const mutate of [d => d.tests.novelty.evidence_ids = ['invented'], d => d.candidate_version = 2,
    d => d.technical_checks = [], d => d.competitors[0].url = 'https://invented.example',
    d => d.technical_checks[0].dependency_id = 'unknown', d => d.evidence = [{ ...source, url: 'https://invented.example' }]]) {
    const d = draft(); mutate(d); assert.equal(validateDraft(d, request().payload, ledger), false);
  }
  assert.equal(validateDraft(draft(), request().payload, { ...ledger,
    evidence: [{ ...source, source_kind: 'project_self_report' }] }), false);
});

test('a GitHub topic directory is a discovery lead rather than a read competitor project', () => {
  const d = draft(), listing = { ...source, url: 'https://github.com/topics/decision-log' };
  d.tests.novelty.result = 'insufficient_evidence'; d.tests.novelty.missing_information = ['Read the actual project'];
  d.competitors[0].url = listing.url;
  assert.equal(validateDraft(d, request().payload, { ...ledger, evidence: [listing] }), false);
});

test('Devpost galleries and competition pages cannot stand in for a read hackathon project', () => {
  for (const url of ['https://devpost.com/software', 'https://devpost.com/hackathons',
    'https://sample-hackathon.devpost.com/project-gallery']) {
    const d = draft(), listing = { ...source, url };
    d.tests.novelty.result = 'insufficient_evidence'; d.tests.novelty.missing_information = ['Read the actual project'];
    d.competitors[0].url = url;
    assert.equal(validateDraft(d, request().payload, { ...ledger, evidence: [listing] }), false);
  }
});
test('only both pass results can produce overall passed', () => {
  for (const [novelty, feasibility, expected] of [['pass', 'pass', true], ['fail', 'pass', false],
    ['pass', 'fail', false], ['insufficient_evidence', 'pass', false]]) {
    const d = draft(); d.tests.novelty.result = novelty; d.tests.feasibility.result = feasibility;
    const result = finalizeReport(d, request().payload, ledger);
    assert.equal(result.passed, expected); assert.equal(result.candidate_version, 1);
    assert.equal(result.report_schema_version, '1.2'); assert.ok(result.report_id);
    assert.equal(result.evidence[0].url, source.url);
  }
});
test('incomplete retrieval cannot produce a passing result', () => {
  const result = finalizeReport(draft(), request().payload, { ...ledger, incomplete: true });
  assert.equal(result.passed, false); assert.equal(result.tests.novelty.result, 'insufficient_evidence');
  assert.equal(result.status, 'partial');
});
test('investigation validates issue and refuses invented official support', () => {
  const p = request('evaluator.investigate').payload;
  assert.equal(validateDraft(investigation(), p, ledger), true);
  assert.equal(validateDraft({ ...investigation(), issue_id: 'other' }, p, ledger), false);
  assert.equal(validateDraft({ ...investigation(), evidence_ids: [] }, p, ledger), false);
});
test('malformed model collections are invalid output rather than validator exceptions', () => {
  for (const mutate of [d => d.technical_checks = [null], d => d.competitors = [null],
    d => d.tests.feasibility = null, d => d.consensus = true]) {
    const d = draft(); mutate(d); assert.equal(validateDraft(d, request().payload, ledger), false);
  }
});
test('rejects hidden private fields nested in room configuration or contribution objects', () => {
  for (const mutate of [r => r.payload.room_config.messages = ['private'],
    r => r.payload.candidate.contributions = [{description:'x',origin:'agent_synthesis',source_refs:[],messages:['private']}],
    r => r.payload.previous_report = {messages:['private']}]) {
    const r=request(); mutate(r); assert.throws(() => normalizeRequest(r), {code:'INVALID_INPUT'});
  }
});
test('novelty cannot pass or fail using member skills instead of an actual project source', () => {
  const member = { ...source, evidence_id:'member-1', url:null, source_kind:'member_report' };
  const memberLedger = { ...ledger, evidence:[member] };
  for (const result of ['pass', 'fail']) {
    const d=draft(); d.tests.novelty.result=result; d.competitors=[];
    for(const t of Object.values(d.tests)) t.evidence_ids=['member-1'];
    d.technical_checks[0].conclusion='member_reported'; d.technical_checks[0].evidence_ids=['member-1'];
    assert.equal(validateDraft(d,request().payload,memberLedger),false);
  }
});
test('successful no-results searches on both required platforms support qualified novelty pass with no invented competitors', () => {
  const d=draft(); d.competitors=[]; d.tests.novelty.evidence_ids=[];
  assert.equal(validateDraft(d, request().payload, { ...ledger,
    search_log: ['github', 'devpost'].map(scope => scopedSearch(scope, 'no_results')) }), true);
  assert.equal(validateDraft(d, request().payload, { ...ledger,
    search_log: [scopedSearch('github', 'no_results')] }), false);
});
test('rejects private fields hidden inside historical evidence and team source references', () => {
  for(const mutate of [r=>r.payload.previous_report={evidence:[{messages:['private']}]},
    r=>r.payload.team_criteria.criteria=[{id:'c',text:'criteria',acceptance:'proposed',member_source_refs:[{messages:['private']}]}],
    r=>r.payload.previous_report={tests:{novelty:{messages:['private']}}}]) {
    const r=request();mutate(r);assert.throws(()=>normalizeRequest(r),{code:'INVALID_INPUT'});
  }
});
test('investigation answer is attributed only to its cited sources', () => {
  const member={...source,evidence_id:'member-1',url:null,source_kind:'member_report'};
  const result=finalizeReport(investigation(),request('evaluator.investigate').payload,{...ledger,evidence:[member,source]});
  assert.ok(!result.evidence[0].claim.includes('官方文档支持订阅'));
  assert.ok(result.evidence[1].claim.includes('官方文档支持订阅'));
});
test('competitors require a public URL even when the novelty test is incomplete', () => {
  const d = draft(), member = { ...source, evidence_id: 'member-1', url: null, source_kind: 'member_report' };
  d.tests.novelty = { result: 'insufficient_evidence', reason: '只有成员自述', evidence_ids: ['member-1'],
    required_changes: [], missing_information: ['公开项目来源'] };
  d.competitors[0].url = null; d.competitors[0].evidence_ids = ['member-1'];
  assert.equal(validateDraft(d, request().payload, { ...ledger, evidence: [source, member] }), false);
});
test('reports cannot describe research without making a search when a search budget is available', () => {
  const d = draft(); d.tests.novelty.result = 'insufficient_evidence'; d.tests.novelty.missing_information = ['Compare projects'];
  assert.equal(validateDraft(d, request().payload, { ...ledger, search_log: [] }), false);
});

test('evaluation must attempt both minimum platforms before submitting with a two-search budget', () => {
  const d = draft(); d.tests.novelty.result = 'insufficient_evidence';
  d.tests.novelty.missing_information = ['Devpost search remains unfinished'];
  const githubOnly = { ...ledger, search_log: [scopedSearch('github')] };
  assert.equal(validateDraft(d, request().payload, githubOnly), false);
  const duplicate = { ...ledger, search_log: [scopedSearch('github'), scopedSearch('github')] };
  assert.equal(validateDraft(d, request().payload, duplicate), false);
  const failedAttempt = { ...scopedSearch('devpost', 'failed'), error_code: 'TOOL_UNAVAILABLE' };
  assert.equal(validateDraft(d, request().payload, { ...ledger,
    search_log: [scopedSearch('github'), failedAttempt], incomplete: true }), true);
  const p = request().payload; p.tool_budget.max_searches = 1;
  assert.equal(validateDraft(d, p, githubOnly), true);
});

test('historical reports without scoped search metadata remain accepted as planning context', () => {
  const report = finalizeReport(draft(), request().payload, ledger);
  const legacySearch = [{ query: 'team decision workflow', result_status: 'results' }];
  const { novelty_coverage: _coverage, ...old12 } = report;
  old12.search_log = legacySearch;
  const r12 = request(); r12.payload.previous_report = old12;
  assert.doesNotThrow(() => normalizeRequest(r12));
  const { version: _version, feasibility: _feasibility, similar_projects: _similar,
    unknowns: _unknowns, sources: _sources, ...old11 } = old12;
  old11.report_schema_version = '1.1';
  old11.technical_checks = draft().technical_checks;
  const r11 = request(); r11.payload.previous_report = old11;
  assert.doesNotThrow(() => normalizeRequest(r11));
});
test('generic member skills cannot prove an input critical API dependency is available', () => {
  const p = request().payload, item = p.shared_resources[0], member = { ...source, evidence_id: 'member-1', url: null,
    source_kind: 'member_report', source_ref: { profile_id: item.profile_id, profile_version: item.profile_version,
      item_id: item.item_id, member_id: item.member_id } };
  const d = draft(); d.tests.feasibility.evidence_ids = ['member-1'];
  d.technical_checks[0].conclusion = 'member_reported'; d.technical_checks[0].evidence_ids = ['member-1'];
  assert.equal(validateDraft(d, p, { ...ledger, evidence: [source, member] }), false);
  p.shared_resources[0].category = 'resource';
  p.shared_resources[0].text = 'A supplied test resource is actually available to this team.';
  assert.equal(validateDraft(d, p, { ...ledger, evidence: [source, member] }), true);
});
