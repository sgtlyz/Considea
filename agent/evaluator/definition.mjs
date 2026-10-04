import { readFileSync } from 'node:fs';
import { defineRole } from '../pi-base/roles.mjs';
import { validateDraft } from './contracts.mjs';

const skills = ['candidate-research', 'technical-feasibility'].map(name =>
  readFileSync(new URL(`./skills/${name}/SKILL.md`, import.meta.url), 'utf8')).join('\n\n');
const evaluationShape = {
  candidate_id: 'COPY_INPUT_ID', candidate_version: 1,
  tests: Object.fromEntries(['novelty', 'feasibility'].map(k => [k, { result: 'pass|fail|insufficient_evidence',
    reason: '理由和前提', evidence_ids: ['tool evidence id'], required_changes: [], missing_information: [] }])),
  competitors: [{ name: '真实项目名称', url: '实际来源URL', overlap: ['重合点'], differences: ['差异'],
    maturity: 'self_reported_implemented|planned|unknown', evidence_ids: ['tool evidence id'] }],
  technical_checks: [{ dependency_id: 'COPY_DEPENDENCY_ID', finding: '发现',
    conclusion: 'documented_support|documented_blocker|member_reported|unknown', evidence_ids: [], next_check: '下一步' }],
  risks: [], unverified_assumptions: [], recommended_changes: [],
};
const investigationShape = { issue_id: 'COPY_INPUT_ISSUE', candidate_id: 'COPY_INPUT_ID', candidate_version: 1,
  answer: '回答', conclusion: 'documented_support|documented_blocker|member_reported|unknown',
  evidence_ids: [], limitations: [], recommended_next_step: '下一步' };

export function createDefinition(request, session) {
  const spec = shape => ({ validateInput: () => true, // runEvaluator has validated and cloned this exact request.
    validateOutput: (d, p) => validateDraft(d, p, session.snapshot()),
    outputInstructions: `data 必须严格符合以下形状。枚举示例用 | 分隔，输出只能选一个值；version 从输入复制。
${JSON.stringify(shape)}
不得生成 passed/report_id/report_schema_version/status/evidence/search_log 等由服务器生成的 data 字段。
成员来源ID与原文如下：${JSON.stringify(session.snapshot().evidence)}
正文必须先 read_source 才能引用；previous_report 不是本次证据。证据不足填 insufficient_evidence 并列出 missing_information。
预算耗尽或失败时仍尽量返回完整结构，未核实项写 unknown；不要编造来源填补。
总体 status 表示执行完整性，业务测试失败本身用 status=ok。` });
  const definition = defineRole('evaluator', { [request.operation]: spec(request.payload.question ? investigationShape : evaluationShape) },
    () => session.tools);
  return { ...definition, systemPrompt: `${definition.systemPrompt}\n${skills}\n当前日期（UTC）：${new Date().toISOString()}\n你接收细化 idea，对查重和可行性给出明确测试结论和依据。` };
}
