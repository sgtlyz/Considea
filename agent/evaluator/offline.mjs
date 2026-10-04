import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { normalizeRequest } from './contracts.mjs';
import { runEvaluator } from './runner.mjs';

/** Entirely synthetic runtime for wiring demonstrations. Does not assess a real project's merits. */
export async function runOffline(request) {
  let req; try { req = normalizeRequest(request); } catch { return runEvaluator({ request }); }
  const p = req.payload, competitor = 'https://project.example.org/team-planner', docs = 'https://docs.example.org/realtime';
  const final = p.question ? { issue_id: p.question.issue_id, candidate_id: p.candidate.candidate_id,
    candidate_version: p.candidate.version, answer: 'fixture：示例文档展示该能力，实际项目尚未核实。',
    conclusion: 'documented_support', evidence_ids: ['web-2'], limitations: ['合成数据，未联网'], recommended_next_step: '配置真实服务后核实' } : {
    candidate_id: p.candidate.candidate_id, candidate_version: p.candidate.version,
    tests: { novelty: { result: 'pass', reason: 'fixture：同类项目只生成计划，当前 idea 还有协商流程。',
      evidence_ids: ['web-1'], required_changes: [], missing_information: [] },
    feasibility: { result: 'pass', reason: 'fixture：示例文档支持依赖，示例团队资源与时间允许。',
      evidence_ids: ['web-2'], required_changes: [], missing_information: [] } },
    competitors: [{ name: 'Fixture Team Planner', url: competitor, overlap: ['团队计划'], differences: ['没有协商流程'],
      maturity: 'self_reported_implemented', evidence_ids: ['web-1'] }],
    technical_checks: p.candidate.critical_dependencies.map(v => ({ dependency_id: v.dependency_id,
      finding: 'fixture：示例文档支持该能力', conclusion: 'documented_support', evidence_ids: ['web-2'], next_check: '真实 API 验证' })),
    risks: ['合成数据，不能用于判断真实 idea'], unverified_assumptions: ['未联网核实'], recommended_changes: [] };
  const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('search', { query: 'fixture similar projects' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('read_source', { url: competitor }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('read_source', { url: docs }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(JSON.stringify({ status: 'ok', data: final, warnings: ['fixture：合成模型与检索数据，未调用真实 API。'] })),
  ]);
  const retrieval = {
    search: async () => ({ results: [{ url: competitor, title: 'Fixture Team Planner', content: '生成团队计划。' },
      { url: docs, title: 'Fixture documentation', content: '示例接口文档。' }] }),
    read: async url => ({ url, content: url === competitor ? '示例项目只生成计划，没有独立访谈或协商流程。' : '示例 API 支持核心能力。' }),
  };
  const result = await runEvaluator({ request: req, retrieval, officialDomains: ['docs.example.org'],
    model: faux.getModel(), streamFn: models.streamSimple.bind(models) });
  return { ...result, data: { ...result.data, fixture: true },
    warnings: [...result.warnings, 'fixture：仅验证接线，不能作为真实 idea 的评估结果。'] };
}
