export const idea = {
  candidate_id: 'idea-1', version: 1, title: '团队选题协调员',
  target_users: ['四人比赛团队'], problem: '队员难以形成共同选题',
  core_flow: ['独立访谈', '整合候选', '查重和可行性测试', '协商'],
  mvp_scope: ['完成一个候选的评估'], out_of_scope: ['语音'],
  critical_dependencies: [{ dependency_id: 'db', description: '共享状态实时同步', must_have: true }],
  contributions: [], tradeoffs: [], unknowns: [], change_summary: '', iteration_index: 1,
};
export function request(operation = 'evaluator.evaluate') {
  return { schema_version: '1.0', request_id: 'req-1', room_id: 'room-1', input_revision: 1, operation,
    payload: { candidate: structuredClone(idea),
      room_config: { room_id: 'room-1', member_ids: ['member-a'], deadline_at: null,
        max_iterations: 3, initial_interview_max_rounds: 7, max_questions_per_turn: 3,
        followup_batches_per_member_per_iteration: 1,
        constraints: [{ id: 'time', text: '18 小时完成最小 demo', source_kind: 'member_report',
          source_id: 'member-a', verification_status: 'member_reported', acceptance: 'team_confirmed' }] },
      team_criteria: { version: 1, criteria: [], unresolved_tradeoffs: [] },
      shared_resources: [{ profile_id: 'p-a', profile_version: 1, item_id: 'skill-a', member_id: 'member-a',
        category: 'skill', text: '团队能使用 Node 和数据库' }], previous_report: null,
      tool_budget: { max_searches: 2, max_reads: 3, timeout_ms: 60000, per_call_timeout_ms: 10000 },
      ...(operation.endsWith('investigate') ? { question: { issue_id: 'issue-1', text: '是否支持实时同步？',
        expected_information: '官方接口能力' } } : {}) } };
}
export const source = { evidence_id: 'web-1', url: 'https://docs.example.com/realtime', title: 'Realtime',
  accessed_at: '2026-10-03T12:00:00.000Z', source_kind: 'official_documentation',
  excerpt: '支持订阅表变更。', limitation: '文档支持不等于已接通。' };
export function draft() {
  const check = { result: 'pass', reason: '本次检索未发现高度相同且无差异的项目。',
    evidence_ids: ['web-1'], required_changes: [], missing_information: [] };
  return { candidate_id: 'idea-1', candidate_version: 1, tests: { novelty: structuredClone(check),
    feasibility: { ...structuredClone(check), reason: '官方文档支持关键能力，团队资源和时间支持最小 demo。' } },
    competitors: [{ name: '示例项目', url: source.url, overlap: ['协作'], differences: ['没有独立访谈'],
      maturity: 'self_reported_implemented', evidence_ids: ['web-1'] }],
    technical_checks: [{ dependency_id: 'db', finding: '官方文档支持订阅', conclusion: 'documented_support',
      evidence_ids: ['web-1'], next_check: '实际接入验证' }], risks: ['未实际运行'],
    unverified_assumptions: [], recommended_changes: [] };
}
export function investigation() {
  return { issue_id: 'issue-1', candidate_id: 'idea-1', candidate_version: 1, answer: '官方文档支持订阅。',
    conclusion: 'documented_support', evidence_ids: ['web-1'], limitations: ['尚未运行'],
    recommended_next_step: '接入后测试' };
}
export const retrieval = {
  search: async () => ({ results: [{ url: source.url, title: source.title, content: '订阅文档' }] }),
  read: async url => ({ url, title: source.title, content: source.excerpt }),
};
