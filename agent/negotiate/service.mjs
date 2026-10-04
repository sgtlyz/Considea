import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { runAgent } from '../pi-base/base.mjs';

const schema = JSON.parse(readFileSync(new URL('../interfaces/protocol.schema.json', import.meta.url), 'utf8'));
const systemPrompt = readFileSync(new URL('./prompt.txt', import.meta.url), 'utf8');
const ajv = new Ajv({ strict: false, allErrors: false });
addFormats(ajv);
const compile = name => ajv.compile({ $schema: schema.$schema, $defs: schema.$defs, $ref: `#/$defs/${name}` });
const inputShape = compile('NegotiateDetectInput'), dataShape = compile('NegotiateDetectData');
const envelopeKeys = ['schema_version', 'request_id', 'room_id', 'operation', 'input_revision'];
const unique = xs => new Set(xs).size === xs.length;
const nonblank = x => typeof x === 'string' && x.trim().length > 0;
const sameRef = (a, b) => a?.id === b?.id && a?.version === b?.version;

export function validateInput(p) {
  if (!inputShape(p)) return false;
  const members = new Set(p.room_context.member_ids), s = p.shared_context;
  const sources = new Map(s.sources.map(source => [source.source_id, source]));
  if (sources.size !== s.sources.length || !unique(s.profiles.map(profile => profile.member_id))) return false;
  if (s.sources.some(source => source.member_id !== null && !members.has(source.member_id))) return false;
  for (const profile of s.profiles) {
    if (!members.has(profile.member_id)) return false;
    for (const item of profile.items) {
      const source = sources.get(item.source_id);
      if (!source || source.kind !== 'profile_item' || source.member_id !== profile.member_id ||
          !sameRef(source.object_ref, profile.profile_ref)) return false;
    }
  }
  return s.discussion_history.every(record => Object.entries(record)
    .filter(([key]) => key.endsWith('_source_ids')).every(([, ids]) => ids.every(id => sources.has(id))));
}

export function outputIssues(data, p) {
  if (!dataShape(data)) return [{ code: 'OUTPUT_SHAPE', path: '/data' }];
  const d = data.difference, members = new Set(p.room_context.member_ids);
  const sources = new Map(p.shared_context.sources.map(s => [s.source_id, s]));
  if (!nonblank(d.question) || !nonblank(d.why_it_matters) ||
      d.options.some(o => !nonblank(o.key) || !nonblank(o.label))) {
    return [{ code: 'EMPTY_TEXT', path: '/data/difference' }];
  }
  if (d.affected_member_ids.some(id => !members.has(id))) {
    return [{ code: 'UNKNOWN_MEMBER', path: '/data/difference/affected_member_ids' }];
  }
  if (d.source_ids.some(id => !sources.has(id))) {
    return [{ code: 'UNKNOWN_SOURCE', path: '/data/difference/source_ids' }];
  }
  if (!unique(d.options.map(o => o.key))) return [{ code: 'DUPLICATE_OPTION', path: '/data/difference/options' }];
  // A team split needs human evidence from two people. One person's apparent
  // inconsistency must remain a private clarification, not become a team conflict.
  if (d.kind === 'difference') {
    const statements = new Set(p.shared_context.profiles.flatMap(profile => profile.items
      .filter(item => item.basis === 'member_statement').map(item => item.source_id)));
    const owners = new Set(d.source_ids.map(id => sources.get(id))
      .filter(s => (s.kind === 'difference_answer' || (s.kind === 'profile_item' && statements.has(s.source_id))) &&
        d.affected_member_ids.includes(s.member_id)).map(s => s.member_id));
    if (owners.size < 2) return [{ code: 'TWO_MEMBER_EVIDENCE_REQUIRED', path: '/data/difference/source_ids' }];
  }
  return [];
}

function outputSchema(p) {
  const resolve = value => {
    if (Array.isArray(value)) return value.map(resolve);
    if (!value || typeof value !== 'object') return value;
    if (value.$ref) return resolve(schema.$defs[value.$ref.split('/').at(-1)]);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
  };
  const result = resolve(schema.$defs.NegotiateDetectData);
  result.properties.difference.properties.affected_member_ids.items.enum = [...p.room_context.member_ids];
  const ids = p.shared_context.sources.map(source => source.source_id);
  if (ids.length) result.properties.difference.properties.source_ids.items.enum = ids;
  else result.properties.difference.properties.source_ids.maxItems = 0;
  return result;
}

const definition = {
  name: 'negotiate', systemPrompt,
  operations: { 'negotiate.detect': {
    validateInput,
    validateOutput: (data, p) => outputIssues(data, p).length === 0,
    outputSchema,
    outputInstructions: 'Return status=ok and exactly one evidence-grounded difference or clarification.',
    normalizeOutput: raw => raw?.status === 'ok' ? raw : null,
    outputIssues: (raw, p) => raw?.status === 'ok' ? outputIssues(raw.data, p)
      : [{ code: 'STATUS_MUST_BE_OK', path: '/status' }],
  } },
};

function errorResponse(request, code, message) {
  return { ...Object.fromEntries(envelopeKeys.map(key => [key, request?.[key] ?? null])),
    status: 'error', data: {}, warnings: [], error: { code, message, retryable: false } };
}

/** Tool-free, stateless LLM role. Failure never silently selects a rule-based topic. */
export async function runNegotiator({ request, runtime, timeoutMs = 60_000, onDiagnostic }) {
  if (!request || request.schema_version !== '1.0' || request.operation !== 'negotiate.detect' ||
      Object.keys(request).some(key => ![...envelopeKeys, 'payload'].includes(key)) ||
      !['request_id', 'room_id'].every(key => nonblank(request[key])) ||
      !Number.isSafeInteger(request.input_revision) || request.input_revision < 0 || !validateInput(request.payload)) {
    return errorResponse(request, 'INVALID_INPUT', 'Invalid authorized Negotiator context');
  }
  if (!runtime?.model || typeof runtime.streamFn !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    return errorResponse(request, 'CONFIG_ERROR', 'Configure a model runtime and a bounded timeout');
  }
  return runAgent({ request: structuredClone(request), definition,
    model: runtime.model, streamFn: runtime.streamFn, timeoutMs,
    maxTurns: 2, maxToolCalls: 1, maxOutputRepairs: 1, onDiagnostic });
}
