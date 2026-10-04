import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runInterview } from '../service.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const length = value => [...value].length;
const requiredCategories = new Set(['constraint', 'participation_condition']);
export class JsonStore {
  constructor(directory) { this.directory = resolve(directory); mkdirSync(this.directory, { recursive: true }); }
  path(key) { return join(this.directory, `${digest(key)}.json`); }
  read(key) { try { return JSON.parse(readFileSync(this.path(key), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  write(key, value) {
    const target = this.path(key), tmp = `${target}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, target);
  }
}

export function buildBrief(profile) {
  const ordered = [...profile.items.filter(i => requiredCategories.has(i.category)), ...profile.items.filter(i => !requiredCategories.has(i.category))];
  const selected = ordered.filter(i => length(i.brief_text ?? i.text) <= 80).slice(0, 8);
  const missing = ordered.filter(i => requiredCategories.has(i.category) && !selected.includes(i));
  return { profile_id: profile.profile_id, profile_version: profile.version,
    status: missing.length ? 'needs_review' : 'ready',
    items: selected.map(i => ({ category: i.category, text: i.brief_text ?? i.text, source_item_ids: [i.item_id] })),
    omitted_item_ids: ordered.filter(i => !selected.includes(i)).map(i => i.item_id),
    blocking_item_ids: missing.map(i => i.item_id), unknowns: profile.unknowns };
}

const help = 'Considea Interview：我会提问、保存偏好档案，再由你审核导出。\n命令：/profile 查看详细档案；/finish 结束提问并审核；/edit 序号 新文字；/drop 序号；/short 序号 短句（最多80字）；/export 导出已批准结果。\n访谈与草稿保存在运行此 Agent 的服务端，不会自动发送给队友。真实模式会将访谈内容交给 DeepSeek。';

/** Single-process controller. ACP transport serializes calls; no model-generated approval commands. */
export class InterviewSession {
  constructor({ store, runtimeFor, runner = runInterview, maxBatches = 5 }) {
    if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 7) throw new Error('Invalid batch limit');
    Object.assign(this, { store, runtimeFor, runner, maxBatches });
  }
  initial(key) {
    return { profile_id: randomUUID(), member_id: `member-${digest(key).slice(0, 24)}`, version: 0,
      messages: [], items: [], unknowns: [], answered_batches: 0, phase: 'new', revision: 0,
      approved: null, brief: null, events: {}, history: [], approval_token: null };
  }
  payload(s, operation) {
    const sourceItems = s.approved?.items ?? [];
    const sharedProfile = s.approved ? { profile_ref: { id: s.profile_id, version: s.approved.version }, member_id: s.member_id,
      items: sourceItems.map(i => ({ item_id: i.item_id, category: i.category, text: i.text, basis: i.basis, confidence: i.confidence,
        source_id: `${s.profile_id}:${s.approved.version}:${i.item_id}` })), unknowns: s.approved.unknowns } : null;
    return { contract_version: '2.1', discussion_round: 1, room_context: { member_ids: [s.member_id],
      hackathon_context: 'Single-participant hackathon preparation. Produce a reviewed preference handoff, not team consensus.', deadline_at: null, constraints: [] },
    member_id: s.member_id, mode: 'initial', messages: s.messages, current_profile: sharedProfile,
    shared_context: { profiles: sharedProfile ? [sharedProfile] : [], discussion_history: [], sources: sourceItems.map(i => ({
      source_id: `${s.profile_id}:${s.approved.version}:${i.item_id}`, kind: 'profile_item', object_ref: sharedProfile.profile_ref,
      member_id: s.member_id, discussion_round: 1, text: i.text })) }, followup_context: null,
    ...(operation === 'interview.turn' ? { interview_turn: s.answered_batches + 1,
      limits: { max_questions: 3, remaining_question_batches: Math.max(0, this.maxBatches - s.answered_batches) } } : { stop_reason: 'member_requested' }) };
  }
  async call(s, operation) {
    const request = { schema_version: '1.0', request_id: randomUUID(), room_id: `private-${s.member_id}`, operation,
      input_revision: s.revision, payload: this.payload(s, operation) };
    const result = await this.runner({ request, runtime: await this.runtimeFor(operation) });
    if (result.status === 'error') throw Object.assign(new Error('Agent operation failed'), { code: result.error?.code });
    return result.data;
  }
  async updateProfile(s) {
    const data = await this.call(s, 'interview.summarize');
    const previous = s.items;
    s.history.push({ version: s.version, items: structuredClone(previous), unknowns: s.unknowns });
    s.items = data.profile_draft.items.map(i => {
      const old = previous.find(x => x.category === i.category && x.text === i.text);
      return { ...i, item_id: old?.item_id ?? randomUUID(), ...(old?.brief_text ? { brief_text: old.brief_text } : {}) };
    });
    s.unknowns = data.profile_draft.unknowns; s.version++; s.revision++;
    s.approval_token = null; s.brief = null;
  }
  async ask(s) {
    const data = await this.call(s, 'interview.turn');
    if (data.ready_to_summarize) { s.phase = 'review'; return this.review(s); }
    s.phase = 'answering';
    const text = data.questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n');
    s.messages.push({ message_id: randomUUID(), role: 'assistant', content: text });
    return `第 ${s.answered_batches + 1}/${this.maxBatches} 批问题（可一次回答，也可 /finish）：\n${text}`;
  }
  review(s) {
    s.approval_token ??= randomUUID().slice(0, 8);
    return `已保存详细档案 v${s.version}，尚未批准。\n${s.items.map((i, n) => `${n + 1}. [${i.category} · ${i.basis === 'agent_inference' ? 'AI推断，请核实' : '成员自述'}] ${i.text}`).join('\n')}\n未知：${s.unknowns.join('；') || '无已记录未知项'}\n请核对数字、限制及AI推断。可用 /edit、/drop、/short 修改。本人确认后发送 /approve ${s.revision} ${s.approval_token}；这会生成可交接档案与短摘要，不会自动发给队友。`;
  }
  export(s) {
    if (!s.approved) return '尚未批准任何档案。请先 /finish 审核。';
    // Private message IDs and raw transcript stay local even in the exported full profile.
    const artifact = { preference_profile: s.approved, preference_summary: s.brief ?? buildBrief(s.approved) };
    return `已批准交接包（${artifact.preference_summary.status === 'ready' ? '摘要可用' : '摘要待修改，部分约束无法装入8条/每条80字预算'}）：\n\n\`\`\`json\n${JSON.stringify(artifact, null, 2)}\n\`\`\`\n完整档案包含所有批准条目。摘要省略项可按 item_id 回查；本演示未向 Negotiate 或队友发送。`;
  }
  async handle({ sender, session_id, msg_id, text }) {
    if (![sender, session_id, msg_id, text].every(x => typeof x === 'string' && x.trim()) || text.length > 16_000) {
      return { ok: false, text: '消息缺少会话信息或长度超过16,000字符。', end_session: false };
    }
    const key = JSON.stringify([sender, session_id]), fingerprint = digest(text);
    let stored = this.store.read(key) ?? this.initial(key);
    const old = stored.events[msg_id];
    if (old) return old.fingerprint !== fingerprint ? { ok: false, text: '重复消息ID对应不同内容，已拒绝。', end_session: false }
      : old.result ?? { ok: false, text: '该请求处理结果尚不明确，没有自动重试。请查看 /profile 后重新提交。', end_session: false };
    if (Object.keys(stored.events).length >= 120) return { ok: false, text: '本会话已到消息上限，请开启新的 ASI 会话。', end_session: false };
    stored.events[msg_id] = { fingerprint, status: 'pending' }; this.store.write(key, stored);
    const s = structuredClone(stored);
    let reply;
    try {
      const command = text.trim();
      if (command === '/help') reply = help;
      else if (command === '/profile') reply = `当前详细档案 v${s.version}（${s.phase}）：\n${JSON.stringify({ profile_id: s.profile_id, items: s.items, unknowns: s.unknowns }, null, 2)}`;
      else if (command === '/export') reply = this.export(s);
      else if (command.startsWith('/approve ')) {
        if (s.phase !== 'review' || command !== `/approve ${s.revision} ${s.approval_token}`) throw new Error('Stale approval');
        s.approved = { profile_id: s.profile_id, member_id: s.member_id, version: s.version,
          approved_at: new Date().toISOString(), items: s.items.map(({ private_message_ids, item_key, ...i }) => i), unknowns: s.unknowns };
        s.brief = buildBrief(s.approved); s.phase = 'approved'; s.approval_token = null;
        reply = this.export(s);
      } else if (/^\/(edit|drop|short)\b/.test(command)) {
        if (!['review', 'approved'].includes(s.phase)) throw new Error('Finish interview before editing');
        const m = command.match(/^\/(edit|drop|short) ([1-9]\d*)(?: ([\s\S]+))?$/);
        const item = m && s.items[Number(m[2]) - 1];
        if (!item || (m[1] !== 'drop' && !m[3]?.trim()) || (m[1] === 'short' && length(m[3]) > 80)) throw new Error('Invalid edit');
        s.history.push({ version: s.version, items: structuredClone(s.items), unknowns: s.unknowns });
        if (m[1] === 'drop') s.items.splice(Number(m[2]) - 1, 1);
        else if (m[1] === 'short') item.brief_text = m[3];
        else { item.text = m[3]; item.basis = 'member_statement'; delete item.brief_text; item.private_message_ids = []; }
        s.revision++; s.version++; s.phase = 'review'; s.brief = null; s.approval_token = null;
        // Revocation is immediate. Do not keep exporting an old approved version after a deletion/edit.
        s.approved = null; reply = this.review(s);
      } else if (command === '/finish') {
        if (!s.items.length && !s.messages.some(m => m.role === 'user')) reply = '还没有个人回答；请先描述你的兴趣、痛点或已有想法。';
        else { if (!s.version) await this.updateProfile(s); s.phase = 'review'; reply = this.review(s); }
      } else if (command.startsWith('/')) reply = help;
      else if (s.phase === 'new') {
        if (!['start', '开始', '开始访谈'].includes(command.toLowerCase())) s.messages.push({ message_id: randomUUID(), role: 'user', content: text });
        reply = `${help}\n\n${await this.ask(s)}`;
      } else if (s.phase === 'answering') {
        s.messages.push({ message_id: randomUUID(), role: 'user', content: text }); s.answered_batches++;
        await this.updateProfile(s);
        if (s.answered_batches >= this.maxBatches) { s.phase = 'review'; reply = this.review(s); }
        else reply = `已更新详细档案 v${s.version}（${s.items.length} 条，尚未批准）。\n${await this.ask(s)}`;
      } else reply = s.phase === 'review' ? this.review(s) : '结果已保存。/export 取回；/edit、/drop、/short 修改后需重新批准。';
      const result = { ok: true, text: reply, end_session: false };
      s.events[msg_id] = { fingerprint, status: 'done', result }; this.store.write(key, s); return result;
    } catch (error) {
      const result = { ok: false, text: error?.code === 'MODEL_BUDGET_EXHAUSTED'
        ? '测试模型额度已用完，访谈暂时停止。此前档案仍保留，可用 /profile 查看；已保存的档案仍可审核、编辑和导出。请联系运营者增加授权额度。此次操作未应用，没有自动重试。'
        : error?.code === 'INVALID_OUTPUT' ? '模型返回的档案或问题未通过格式或来源校验，本轮未保存；不是你的操作错误。此前档案仍保留，可用 /profile 查看。没有自动重试或共享。'
        : '此次操作未应用。请检查命令或先前版本；若命令正确，请联系运营者检查服务。/profile 可查看仍保存的内容。没有自动重试或共享。', end_session: false };
      stored.events[msg_id] = { fingerprint, status: 'failed', error_code: error?.code ?? 'WORKFLOW_ERROR', result }; this.store.write(key, stored); return result;
    }
  }
}
