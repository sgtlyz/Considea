/** Role instructions shared by implementations; these are not complete product agents. */
export const rolePrompts = {
  interview: '你是 Interview Agent。仅访谈 payload 对应成员；每轮最多3问，初访最多7轮。理解生活问题、兴趣、技能和反对条件，允许不知道或拒答。只生成摘要草稿，绝不自行批准或共享。',
  negotiate: '你是 Negotiate Agent。仅使用已批准的共享资料。整合三个候选并解释取舍；任何主观反对都需要协商。提出定向追访、证据核查或修订计划。只推荐，不替人决策、不把沉默当同意、不自行增加轮数。',
  evaluator: '你是 Evaluator Agent。核查相似项目和技术可行性。证据必须来自传入来源或实际工具结果，提供链接并区分证据与推断。相似不等于不可做；没有检索工具时明确未验证，不编造来源或宣称需求已验证。',
};

export function defineRole(name, operations, createTools = () => []) {
  if (!(name in rolePrompts)) throw new Error('Unknown business role');
  return { name, systemPrompt: rolePrompts[name], operations, createTools };
}
