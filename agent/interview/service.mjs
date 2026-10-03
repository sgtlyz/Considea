import { runAgent } from '../pi-base/base.mjs';
import definition from './definition.mjs';

export const topics = ['pain', 'idea', 'skill', 'resource', 'preference', 'objection', 'participation_condition'];
export const emptyCoverage = () => Object.fromEntries(topics.map(k => [k, 'unknown']));
const envelopeKeys = ['schema_version', 'request_id', 'room_id', 'operation', 'input_revision'];
const headers = request => Object.fromEntries(envelopeKeys.map(k => [k, request?.[k] ?? null]));
export const errorResponse = (request, code, message) => ({ ...headers(request), status: 'error',
  data: {}, warnings: [], error: { code, message, retryable: false } });

/** Stateless role boundary; call only with workflow-authorized member context. */
export async function runInterview({ request, runtime, onProgress }) {
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
