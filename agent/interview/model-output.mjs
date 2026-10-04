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
  // Some JSON-mode responses put advisory warnings beside the operation fields.
  // Move only this known string-array field; all facts and evidence stay unchanged.
  const nestedWarnings = Object.hasOwn(data, 'warnings');
  if (nestedWarnings) {
    if (!strings(data.warnings)) return invalid();
    warnings.push(...data.warnings); delete data.warnings;
  }
  if (operation === 'interview.summarize' && object(data.profile_draft) && Object.hasOwn(data.profile_draft, 'notes')) {
    if (!strings(data.profile_draft.notes)) return invalid();
    warnings.push(...data.profile_draft.notes); delete data.profile_draft.notes;
  }
  // Only omitted deterministic metadata is supplied. Explicit mismatches stay invalid.
  let supplied = false;
  for (const key of ['contract_version', 'member_id']) {
    if (!Object.hasOwn(data, key)) { data[key] = payload[key]; supplied = true; }
  }
  const items = operation === 'interview.turn' ? data.questions : data.profile_draft?.items;
  const key = operation === 'interview.turn' ? 'question_key' : 'item_key';
  if (Array.isArray(items)) {
    const used = new Set(items.filter(object).map(item => item[key]));
    for (let i = 0; i < items.length; i++) {
      if (!object(items[i]) || Object.hasOwn(items[i], key)) continue;
      let id = `tmp-${key}-${i + 1}`;
      while (used.has(id)) id += '-new';
      items[i][key] = id; used.add(id); supplied = true;
    }
  }
  // Strict schema, source ownership, evidence, member IDs and stop gates still apply.
  if (!validate(data, payload)) return invalid();
  const status = operation === 'interview.turn' && !data.ready_to_summarize ? 'needs_input' : 'ok';
  if (!wrapped || raw.status !== status || raw.notes !== undefined || raw.data?.profile_draft?.notes !== undefined || nestedWarnings || supplied) {
    warnings.push('MODEL_FORMAT_NORMALIZED: transport/omitted metadata only; facts and evidence unchanged');
  }
  return { status, data, warnings };
}
