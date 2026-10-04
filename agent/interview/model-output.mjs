// Repair only redundant transport formatting, never personal facts or evidence.
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const strings = x => Array.isArray(x) && x.every(v => typeof v === 'string');
const invalid = () => { throw Object.assign(new Error('Interview model output has unsupported fields or shape'), { code: 'INVALID_OUTPUT', baseError: true }); };
export function normalizeInterviewOutput(raw, operation, validate, payload) {
  if (!object(raw)) return invalid();
  const fields = operation === 'interview.turn'
    ? ['contract_version', 'member_id', 'questions', 'ready_to_summarize', 'stop_reason']
    : ['contract_version', 'member_id', 'profile_draft'];
  const wrapped = Object.hasOwn(raw, 'data');
  const allowed = wrapped ? ['status', 'data', 'warnings', 'notes'] : [...fields, 'status', 'warnings', 'notes'];
  if (Object.keys(raw).some(k => !allowed.includes(k))) return invalid();
  if (raw.status !== undefined && !['ok', 'needs_input'].includes(raw.status)) return invalid();
  const warnings = raw.warnings === undefined ? [] : structuredClone(raw.warnings);
  if (!strings(warnings)) return invalid();
  const notes = raw.notes ?? [];
  if (!strings(notes)) return invalid();
  warnings.push(...notes);
  const data = structuredClone(wrapped ? raw.data : Object.fromEntries(fields.filter(k => Object.hasOwn(raw, k)).map(k => [k, raw[k]])));
  if (!object(data)) return invalid();
  if (Object.hasOwn(data, 'warnings')) {
    if (!strings(data.warnings)) return invalid();
    warnings.push(...data.warnings);
    delete data.warnings;
    warnings.push('MODEL_FORMAT_NORMALIZED: data.warnings moved to root; content unchanged');
  }
  if (operation === 'interview.summarize' && object(data.profile_draft) && Object.hasOwn(data.profile_draft, 'notes')) {
    if (!strings(data.profile_draft.notes)) return invalid();
    warnings.push(...data.profile_draft.notes); delete data.profile_draft.notes;
  }
  if (operation === 'interview.summarize' && Array.isArray(data.profile_draft?.unknowns)) {
    const ownIds = new Set(payload.messages.filter(m => m.role === 'user').map(m => m.message_id));
    data.profile_draft.unknowns = data.profile_draft.unknowns.map(item => {
      if (typeof item === 'string') return item;
      if (!object(item) || typeof item.text !== 'string' || !item.text.trim() ||
          Object.keys(item).some(k => !['text','item_key','category','basis','confidence','private_message_ids'].includes(k)) ||
          (item.category !== undefined && item.category !== 'unknown') ||
          (item.basis !== undefined && !['member_statement','agent_inference'].includes(item.basis)) ||
          (item.confidence !== undefined && !['high','medium','low'].includes(item.confidence)) ||
          (item.item_key !== undefined && typeof item.item_key !== 'string') ||
          (item.private_message_ids !== undefined && (!strings(item.private_message_ids) || !item.private_message_ids.every(id => ownIds.has(id))))) return invalid();
      warnings.push('MODEL_FORMAT_NORMALIZED: unknown object converted to text after checking source ownership');
      return item.basis === 'agent_inference' ? `[AI推断，待确认] ${item.text}` : item.text;
    });
  }
  // Strict schema, source ownership, evidence, member IDs and stop gates still apply.
  if (!validate(data, payload)) return invalid();
  const status = operation === 'interview.turn' && !data.ready_to_summarize ? 'needs_input' : 'ok';
  if (!wrapped || raw.status !== status || raw.notes !== undefined || raw.data?.profile_draft?.notes !== undefined) {
    warnings.push('MODEL_FORMAT_NORMALIZED: transport wrapper/status/notes only; validated content unchanged');
  }
  return { status, data, warnings };
}
