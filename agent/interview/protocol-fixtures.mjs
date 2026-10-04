import { createOfflineRuntime } from '../pi-base/offline.mjs';

// Synthetic replies for exercising the real harness. Not a model-quality demo.
export function createProtocolFixtureRuntime(operation) {
  return createOfflineRuntime(p => {
    const header = { contract_version: p.contract_version, member_id: p.member_id };
    const data = operation === 'interview.summarize' ? { ...header, profile_draft: {
      items: p.messages.filter(m => m.role === 'user' && m.content.trim()).map((m, i) => ({
        item_key: `mock-${i}`, category: 'interest', text: m.content, basis: 'member_statement',
        confidence: 'low', private_message_ids: [m.message_id],
      })), unknowns: ['OFFLINE MOCK: 分类仅用于结构验证'],
    } } : { ...header, questions: [{ question_key: 'mock-question',
      text: p.mode === 'reopened' ? '对当前候选和评估，你最希望进一步说明什么？'
        : p.mode === 'followup' ? '对于刚才的人工回答，什么条件会改变你的判断？' : '最近有什么想解决的真实问题？',
      purpose: 'OFFLINE MOCK: 固定演示问题', related_source_ids: [],
    }], ready_to_summarize: false, stop_reason: null };
    return { status: operation === 'interview.summarize' ? 'ok' : 'needs_input', data,
      warnings: ['OFFLINE MOCK: 不代表 DeepSeek 输出或真实参与者意见'] };
  });
}
