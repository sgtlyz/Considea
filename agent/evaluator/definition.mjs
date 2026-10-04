import { readFileSync } from 'node:fs';
import { defineRole } from '../pi-base/roles.mjs';
import { validateDraft, object, isProjectListingUrl } from './contracts.mjs';
import { createSubmission } from './submission.mjs';
import { noveltyCoverage, missingNoveltyChecks } from './novelty.mjs';

const skills = Object.fromEntries(['candidate-research', 'technical-feasibility'].map(name =>
  [name, readFileSync(new URL(`./skills/${name}/SKILL.md`, import.meta.url), 'utf8')]));
const evaluationShape = {
  candidate_id: 'COPY_INPUT_ID', candidate_version: 1,
  tests: Object.fromEntries(['novelty', 'feasibility'].map(k => [k, { result: 'pass|fail|insufficient_evidence',
    reason: 'Reason and premises', evidence_ids: ['tool evidence id'], required_changes: [], missing_information: [] }])),
  competitors: [{ name: 'Actual project name', url: 'Actual read source URL', overlap: ['Overlap'], differences: ['Difference'],
    maturity: 'self_reported_implemented|planned|unknown', evidence_ids: ['tool evidence id'] }],
  technical_checks: [{ dependency_id: 'COPY_DEPENDENCY_ID', finding: 'Finding',
    conclusion: 'documented_support|documented_blocker|member_reported|unknown', evidence_ids: [], next_check: 'Next check' }],
  risks: [], unverified_assumptions: [], recommended_changes: [],
};
const investigationShape = { issue_id: 'COPY_INPUT_ISSUE', candidate_id: 'COPY_INPUT_ID', candidate_version: 1,
  answer: 'Answer', capability_outcome: 'available|blocked|unknown', evidence_basis: 'official_documentation|member_report|unknown',
  evidence_ids: [], limitations: [], recommended_next_step: 'Next step' };

export function createDefinition(request, session) {
  const shape = request.payload.question ? investigationShape : evaluationShape;
  const feedback = (result, p) => {
      const ledger = session.snapshot(), d = result?.data, issues = [];
      if (!Array.isArray(result?.warnings)) issues.push('The TOP-LEVEL warnings field is required: use warnings: [] when empty. It must be a sibling of status and data, never inside data.');
      if (!p.question && p.tool_budget.max_searches > 0 && ledger.search_log.length === 0)
        issues.push('No search has actually been performed in this request. Call search and read_source; do not claim that searches surfaced anything from memory.');
      if (!p.question) {
        const coverage = noveltyCoverage(ledger.search_log);
        if (coverage.scopes.filter(v => v.attempts > 0).length < Math.min(2, p.tool_budget.max_searches))
          issues.push('Before submitting, actually attempt the required distinct GitHub and Devpost searches within the supplied search budget. The search tool prioritizes the missing platform.');
        if (d?.tests?.novelty?.result === 'pass' && !coverage.complete)
          issues.push(`Novelty cannot pass with incomplete minimum search coverage. ${missingNoveltyChecks(coverage).join(' ')} Use remaining tools or set novelty=insufficient_evidence and name the gaps.`);
      }
      if (!object(d)) issues.push('Return one JSON object with status, data and warnings, without prose or Markdown fences.');
      else {
        if (!p.question) for (const name of ['novelty', 'feasibility'])
          if (!['pass', 'fail', 'insufficient_evidence'].includes(d.tests?.[name]?.result))
            issues.push(`tests.${name}.result is required. Choose exactly pass, fail, or insufficient_evidence; keep this field when correcting other fields.`);
        if (p.question && (d.evidence_basis === 'official_documentation' || (typeof d.conclusion === 'string' && d.conclusion.startsWith('documented_'))))
          for (const id of Array.isArray(d.evidence_ids) ? d.evidence_ids : [])
            if (ledger.evidence.find(e => e.evidence_id === id)?.source_kind !== 'official_documentation')
              issues.push(`Investigation evidence ${id} is not official_documentation; exclude it from a documented conclusion.`);
        const extra = Object.keys(d).filter(k => !(k in shape));
        if (extra.length) issues.push(`Remove unsupported data fields: ${extra.join(', ')}.`);
        for (const check of Array.isArray(d.technical_checks) ? d.technical_checks : []) {
          if (!object(check)) continue;
          const extra = Object.keys(check).filter(k => !['dependency_id', 'finding', 'conclusion', 'evidence_ids', 'next_check'].includes(k));
          if (extra.length) issues.push(`Technical check ${check.dependency_id}: remove unsupported fields ${extra.join(', ')}. The server generates next_check_status; do not add it or next_check_type.`);
          if (typeof check.conclusion === 'string' && check.conclusion !== 'unknown' && (!Array.isArray(check.evidence_ids) || check.evidence_ids.length === 0))
            issues.push(`Technical check ${check.dependency_id}: ${check.conclusion} requires at least one actually read evidence_id. Read its source with remaining tools or use unknown and set feasibility=insufficient_evidence. Empty references do not support a documented or member conclusion.`);
          if (typeof check.conclusion === 'string' && check.conclusion.startsWith('documented_')) for (const id of Array.isArray(check.evidence_ids) ? check.evidence_ids : [])
            if (ledger.evidence.find(e => e.evidence_id === id)?.source_kind !== 'official_documentation')
              issues.push(`Technical check ${check.dependency_id}: ${id} is not official_documentation. Remove this reference or use unknown.`);
        }
        if (d.tests?.feasibility?.result === 'pass') {
          const unresolved = (Array.isArray(d.technical_checks) ? d.technical_checks : []).filter(v => v &&
            p.candidate.critical_dependencies.find(dep => dep.dependency_id === v.dependency_id)?.must_have !== false &&
            !['documented_support', 'member_reported'].includes(v.conclusion));
          if (unresolved.length) issues.push(`Feasibility cannot pass with unresolved necessary dependencies: ${unresolved.map(v => v.dependency_id).join(', ')}. Check them with remaining tools or set feasibility to insufficient_evidence and list missing_information.`);
        }
        for (const v of Array.isArray(d.competitors) ? d.competitors : []) {
          if (isProjectListingUrl(v?.url)) issues.push(`Competitor ${v?.name ?? 'unknown'} uses a project directory rather than the actual project body. Omit the entry; read the specific project with remaining tools or list it as a lead in missing_information.`);
          if (!Array.isArray(v?.evidence_ids) || !v.evidence_ids.some(id => ledger.evidence.some(e => e.evidence_id === id && e.url === v.url)))
            issues.push(`Competitor ${v?.name ?? 'unknown'} has no read body evidence for its URL. Read it or omit it; do not cite snippets.`);
        }
      }
      return `Your final output was rejected by the server. This is your single correction opportunity within the original tool/time budget. Use submit_report with data matching its schema and a separate warnings array. Use English human-readable fields. Do not weaken or invent evidence.\n${issues.join('\n')}\nCurrent candidate_id=${p.candidate.candidate_id}, candidate_version=${p.candidate.version}.${p.question ? ` Answer only issue_id=${p.question.issue_id}; no whole-candidate evaluation. If the requested capability is NOT possible, capability_outcome MUST be blocked. evidence_basis independently describes the source, never whether the capability works.` : ''}\nAllowed evidence records (IDs, URLs, classifications): ${JSON.stringify(ledger.evidence.map(({ evidence_id, url, source_kind }) => ({ evidence_id, url, source_kind })))}\nOfficial documented conclusions may cite ONLY official_documentation IDs. Member conclusions may cite ONLY member_report IDs.${p.question ? '' : ' A novelty pass needs successful distinct GitHub and Devpost project searches, plus a read competitor cited in the test or zero results on BOTH platforms. Otherwise use insufficient_evidence. Unknown necessary dependencies cannot coexist with feasibility pass.'}\nRequired data template (replace descriptions and choose one enum value): ${JSON.stringify({ ...shape, candidate_id: p.candidate.candidate_id, candidate_version: p.candidate.version, ...(p.question ? { issue_id: p.question.issue_id } : {}) })}`;
    };
  const submission = createSubmission(request.payload, session, feedback);
  const spec = { validateInput: () => true, // runEvaluator has validated and cloned this exact request.
    validateOutput: (d, p) => validateDraft(d, p, session.snapshot()),
    outputMode: 'tool', getOutput: submission.getOutput, onToolResult: submission.onToolResult,
    repairOutput: submission.repairOutput,
    outputInstructions: `After research, use submit_report to finish. Pass exactly two arguments: data and warnings. Do not write the final report as assistant text. The tool schema defines the exact field locations, enum values and candidate identity. The data object has the following shape (choose ONE enum value wherever examples use |):
${JSON.stringify(shape)}
Keep generated reasons and findings concise (one to three sentences each); put remaining gaps in missing_information or limitations. Both tests.novelty.result and tests.feasibility.result are REQUIRED for evaluation, even during a correction. warnings is REQUIRED beside data; use [] when empty. Check these fields before submitting. Do not remove valid fields when correcting another issue.
Do not generate server-owned data fields: passed, report_id, report_schema_version, status, evidence, search_log, novelty_coverage, version, feasibility, similar_projects, unknowns, sources.
Member sources: ${JSON.stringify(session.snapshot().evidence)}
${request.payload.question ? 'Perform ONLY the supplied topic investigation. Use search/read_source for authoritative documentation about the question. Do not search for competitors or evaluate the candidate MVP. conclusion describes whether the REQUESTED CAPABILITY is available, not whether the answer has a citation. For example, a sourced answer "No, the API rejects this" MUST use documented_blocker; a sourced answer "Yes, the API allows this" uses documented_support. Both become supported_by_source, with different outcome values.' : 'First call search separately for scope=github and scope=devpost with descriptive candidate keywords. The runtime prioritizes these domains within the same budget. Then read_source for close project bodies and required official technical documentation BEFORE composing a final evaluation. Use scope=web for additional searches only after both platform attempts.'} Do not output a final JSON on the first turn while tools are available.
Only actual read_source records may be cited. previous_report is historical context, not current evidence. ${request.payload.question ? 'If the question remains unverified, use conclusion=unknown and explain missing evidence in limitations.' : 'If evidence is insufficient, use insufficient_evidence with missing_information; unknown for unverified technical checks. Cover all input critical_dependencies and preserve IDs. Identify omitted necessary API, data, device and implementation dependencies from the MVP; add distinct technical_checks IDs. An empty dependency input does not establish feasibility. Necessary unknown dependencies forbid a feasibility pass.'}
time_limit describes the user's project constraint: none explicitly means no time limit. tool_budget.timeout_ms limits the assessment runtime, never the project delivery window.
Use internal conclusion enums above. The server maps them to workflow fields and marks next checks needs_test; this assessment does not execute the proposed product and cannot claim verified.
The server supplies execution status; business test failure or lack of evidence is still a completed assessment. There is at most ONE correction across invalid submissions. After accepted=true, stop.` };
  if (request.payload.question) spec.outputInstructions += '\nInvestigation submission uses capability_outcome and evidence_basis as SEPARATE fields. available means the REQUESTED CAPABILITY can be performed; blocked means it cannot be performed; unknown means unresolved. An answer "No" to whether capture is allowed after denial MUST be blocked, even though documentation supports that answer. evidence_basis=official_documentation describes the source only. Do not send conclusion in this submission; the server generates the public conclusion and outcome.';
  const definition = defineRole('evaluator', { [request.operation]: spec },
    () => [...session.tools, submission.tool]);
  const operationSkills = request.payload.question ? '' : Object.values(skills).join('\n\n');
  return { ...definition, systemPrompt: `You are the Evaluator Agent. ${request.payload.question ? 'Investigate only the supplied technical question, using actual source reads. Do not evaluate novelty or the whole idea. documented_blocker means the requested capability is unavailable; documented_support means it is available.' : 'Assess the novelty and feasibility of a refined idea from Idea Generator → member refinement → Evaluator → final_review. Do not generate or negotiate ideas, manage discussion rounds, or confirm members. Shared discussion_trace and member_suggestions are authorized summaries.'}\n${operationSkills}\nCurrent UTC date: ${new Date().toISOString()}

Mandatory validity rules for the final report (rules 1–3 and 6 apply only to evaluator.evaluate; investigate performs only the supplied topic investigation):
1. Every competitor MUST have a nonempty evidence_ids array containing a source returned by read_source with the same URL. Search snippets and project directories (including GitHub topics/search pages) are discovery leads, never the actual project body. Omit their entries from competitors and describe the gap in missing_information instead. Do not invent IDs. self_reported_implemented requires an explicit implemented-capability statement from the project author; third-party reviews and directory summaries do not establish it. Otherwise use maturity=unknown. The absence of a feature in a page does not prove that the project lacks it; phrase such differences as unverified or not described in the read source.
2. A novelty pass requires successful separate GitHub repository AND Devpost hackathon-project searches, plus either a read competitor cited by both competitors and tests.novelty, OR genuine zero results on BOTH platforms. A generic or combined OR query never proves both checks. Missing/failed scope coverage forbids pass even when another source looks different. General technical documentation without a compared project is not proof of novelty. If search found relevant results but you cannot read them, use insufficient_evidence. GitHub directories and Devpost competition galleries are not specific project bodies.
3. A feasibility pass is forbidden while ANY input must_have dependency or newly identified necessary dependency is unknown or blocked. Continue checking it while tools and time remain; otherwise use insufficient_evidence with concrete missing_information. Do not add an unknown technical check and still claim pass. Known optional dependencies may remain unknown.
4. documented_support/documented_blocker MUST cite only read sources whose returned source_kind is official_documentation. A page's familiar name does not change its ledger classification. member_reported MUST cite only member_report records. Use unknown when those requirements cannot be met.
5. Investigate MUST answer its question independently, even if unrelated to the candidate MVP. Read an authoritative source before a documented conclusion. Do not skip tools and answer from memory. documented_support means the requested capability is supported; documented_blocker means the requested capability is prevented. Never claim a source-less known answer will be upgraded by the server.
6. Do not finalize early while important gaps can be filled within the supplied search/read budgets. Prioritize one close project's body and the required official documentation; do not spend all searches on generic technical terms at the expense of project comparison.
7. evaluator.evaluate must actually attempt the distinct minimum platform searches before submission when max_searches >= 2, even for an insufficient-evidence result. For budgets 0/1, use only the available calls and report incomplete coverage; never increase the budget. Failed searches are attempts, not successful coverage. Never describe imagined search results. Input critical API/data/device dependencies cannot be supported by generic member skills: member_reported access requires an approved resource item (category=resource) that describes the available resource; otherwise read official documentation or leave the dependency unknown. Keep skill claims confined to team capability checks.
8. All generated human-readable fields, warnings and explanations MUST be in English. Preserve IDs, URLs, quoted source excerpts and supplied proper names. The surrounding instructions may be Chinese; your output language is English.
9. Evidence must be relevant to the SPECIFIC claimed capability, not just hosted on an official domain. Read the body for each necessary capability before documented_support. A storage API page does not prove a file export API; a search lead for Blob does not mean its body was read. Never describe an unread page as read. If the referenced body's excerpt does not support the claim, read the relevant page with remaining tools or mark the check unknown.
10. Preserve the scope of documented behavior: an example for one API or browser does not establish universal permission persistence, recovery UX or re-prompt behavior for another. State the sourced API contract separately from proposed recovery steps. Keep untested browser-specific behavior explicitly uncertain.` };
}
