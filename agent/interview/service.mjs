import { runAgent } from '../pi-base/base.mjs';
import definition from './definition.mjs';
import legacyDefinition from './legacy-definition.mjs';

export const topics = ['pain', 'idea', 'skill', 'resource', 'preference', 'objection', 'participation_condition'];
export const emptyCoverage = () => Object.fromEntries(topics.map(k => [k, 'unknown']));
const envelopeKeys = ['schema_version', 'request_id', 'room_id', 'operation', 'input_revision'];
const headers = request => Object.fromEntries(envelopeKeys.map(k => [k, request?.[k] ?? null]));
export const errorResponse = (request, code, message) => ({ ...headers(request), status: 'error',
  data: {}, warnings: [], error: { code, message, retryable: false } });

/** Stateless role boundary; call only with workflow-authorized member context. */
export async function runLegacyInterview({ request, runtime, onProgress }) {
  const definition = legacyDefinition;
  const spec = definition.operations[request?.operation];
  if (!request || request.schema_version !== '1.0' ||
      !['request_id', 'room_id', 'operation'].every(k => typeof request[k] === 'string' && request[k].trim()) ||
      !Number.isInteger(request.input_revision) || request.input_revision < 0 || !spec ||
      !spec.validateInput(request.payload) || request.payload.room_config.room_id !== request.room_id) {
    return errorResponse(request, 'INVALID_INPUT', 'Invalid Interview request or room/member context');
  }
  const p = request.payload;
  const session = p.private_interview;
  const response = (status, data) => ({ ...headers(request), status, data, warnings: [], error: null });
  const hasAnswers = session.messages.some(m => m.role === 'user' && m.content.trim());
  if (request.operation === 'interview.turn') {
    const limit = session.mode === 'followup' ? 1 : p.room_config.initial_interview_max_rounds;
    const stopReason = session.finish_requested ? 'member_requested'
      : session.round_index >= limit ? 'round_limit' : null;
    if (stopReason) return response('ok', {
      member_id: session.member_id, mode: session.mode, round_index: session.round_index,
      questions: [], coverage: session.coverage ?? emptyCoverage(), ready_to_summarize: true, stop_reason: stopReason,
    });
  }
  if (request.operation === 'interview.summarize' && !hasAnswers) {
    return response('needs_input', { member_id: session.member_id,
      draft_profile: { member_id: session.member_id, items: [], unknowns: topics },
      changes: [], unknowns: topics });
  }
  if (!runtime?.model || typeof runtime.streamFn !== 'function') {
    return errorResponse(request, 'CONFIG_ERROR', 'Select offline mode or configure DeepSeek before model calls');
  }
  return runAgent({ request, definition, ...runtime,
    timeoutMs: 60_000, maxTurns: 1, maxToolCalls: 1, onProgress });
}

/** v2 role entry point. Human event authenticity/completeness remain Workflow responsibilities. */
export async function runInterview({ request, runtime, onProgress, onDiagnostic }) {
  const spec = definition.operations[request?.operation];
  if (!request || request.schema_version !== '1.0' ||
      Object.keys(request).some(k => ![...envelopeKeys, 'payload'].includes(k)) ||
      !['request_id', 'room_id', 'operation'].every(k => typeof request[k] === 'string' && request[k].trim()) ||
      !Number.isSafeInteger(request.input_revision) || request.input_revision < 0 || !spec || !spec.validateInput(request.payload)) {
    return errorResponse(request, 'INVALID_INPUT', 'Invalid v2 Interview context. Use 2.1 for human_diverge or reopened; provide matching human decisions, candidate and evaluation.');
  }
  request = structuredClone(request);
  const p = request.payload;
  if (request.operation === 'interview.turn' && p.limits.remaining_question_batches === 0) {
    return { ...headers(request), status: 'ok', data: { contract_version: p.contract_version, member_id: p.member_id,
      questions: [], ready_to_summarize: true, stop_reason: 'question_budget' }, warnings: [], error: null };
  }
  if (!runtime?.model || typeof runtime.streamFn !== 'function') return errorResponse(request, 'CONFIG_ERROR', 'Configure an offline or DeepSeek runtime');
  const response = await runAgent({ request, definition, model: runtime.model, streamFn: runtime.streamFn,
    timeoutMs: 60_000, maxTurns: 2, maxToolCalls: 1, maxOutputRepairs: 1, onProgress, onDiagnostic });
  if (response.status === 'error') return response;
  const expected = request.operation === 'interview.turn' && !response.data.ready_to_summarize ? 'needs_input' : 'ok';
  if (response.status !== expected) return errorResponse(request, 'INVALID_OUTPUT', 'Interview status does not match its result');
  return response;
}
