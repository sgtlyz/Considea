import { randomUUID } from 'node:crypto';
import { runAgent } from '../pi-base/base.mjs';
import { normalizeRequest, finalizeReport, incompleteDraft, error } from './contracts.mjs';
import { createSession } from './session.mjs';
import { createDefinition } from './definition.mjs';

export function errorResponse(request, code, message, retryable = false) {
  return { ...Object.fromEntries(['schema_version', 'request_id', 'room_id', 'operation', 'input_revision'].map(k => [k, request?.[k] ?? null])),
    status: 'error', data: {}, warnings: [], error: { code, message, retryable } };
}

/** Called after validation, before credentials or external services are needed. */
export function requiredInputResponse(request) {
  const p = request.payload;
  if (p.question || p.room_config.time_limit !== undefined) return null;
  return { ...Object.fromEntries(['schema_version', 'request_id', 'room_id', 'operation', 'input_revision'].map(k => [k, request[k]])),
    status: 'needs_input', data: { candidate_id: p.candidate.candidate_id, version: p.candidate.version,
      questions: [{ question_id: 'project-time-limit', field: 'room_config.time_limit',
        text: 'Does this project have a time limit? Choose no time limit, provide available hours, or provide a deadline with a timezone.',
        options: [{ label: 'No time limit', kind: 'none' }, { label: 'Available hours', kind: 'duration' },
          { label: 'Deadline', kind: 'deadline' }] }] }, warnings: [], error: null };
}

export async function runEvaluator({ request, model, streamFn, retrieval, officialDomains = [],
  onProgress, maxTurns = 8, maxToolCalls = 30 } = {}) {
  let normalized, session;
  try {
    normalized = normalizeRequest(request);
    const pending = requiredInputResponse(normalized);
    if (pending) return pending;
    if (!model || typeof streamFn !== 'function' || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 20 ||
      !Number.isInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 50)
      throw error('CONFIG_ERROR', 'Provide a Pi model/streamFn and valid deployment runtime limits');
    session = createSession(normalized.payload, { retrieval, officialDomains });
    let firstModelCall = true;
    const researchStream = (m, context, options) => {
      // DeepSeek's auto mode sometimes answers from memory even with tools available.
      // Require retrieval rather than allowing an early submit_report on the first turn.
      const requireResearch = firstModelCall && m.provider === 'deepseek' &&
        (normalized.payload.tool_budget.max_searches > 0 || normalized.payload.tool_budget.max_reads > 0);
      firstModelCall = false;
      const initialTool = normalized.payload.tool_budget.max_searches > 0 ? 'search' : 'read_source';
      return streamFn(m, context, { ...options, ...(m.provider === 'deepseek' ? {
        toolChoice: requireResearch ? { type: 'function', function: { name: initialTool } } : 'required',
      } : {}) });
    };
    const result = await runAgent({ request: normalized, model, streamFn: researchStream, onProgress,
      definition: createDefinition(normalized, session), timeoutMs: normalized.payload.tool_budget.timeout_ms, maxTurns, maxToolCalls });
    if (result.status === 'error') {
      if (!['MODEL_TIMEOUT', 'BUDGET_EXCEEDED'].includes(result.error.code)) return result;
      session.markIncomplete(); session.freeze();
      return { ...result, status: 'partial', error: null,
        data: finalizeReport(incompleteDraft(normalized.payload), normalized.payload, session.snapshot()),
        warnings: ['Assessment stopped at its runtime budget; actual evidence was preserved, but no pass can be established.'] };
    }
    if (result.status !== 'ok') session.markIncomplete();
    session.freeze(); const ledger = session.snapshot();
    const data = finalizeReport(result.data, normalized.payload, ledger), partial = ledger.incomplete || data.status === 'partial';
    return { ...result, status: partial ? 'partial' : 'ok', data,
      warnings: [...result.warnings, ...(partial ? ['Assessment has incomplete checks; review missing_information and source limitations.'] : [])] };
  } catch (e) {
    return errorResponse(request, ['INVALID_INPUT', 'CONFIG_ERROR'].includes(e?.code) ? e.code : 'MODEL_ERROR',
      ['INVALID_INPUT', 'CONFIG_ERROR'].includes(e?.code) ? e.message : 'Evaluator failed; inspect protected server diagnostics');
  } finally { session?.freeze(); }
}

/** Convenience entry: the caller supplies the same authorized context the workflow would supply. */
export function evaluateIdea({ idea, context, room_id = context?.room_config?.room_id,
  request_id = randomUUID(), input_revision = 0, ...runtime } = {}) {
  const { candidate: _candidate, idea: _idea, ...rest } = context ?? {};
  return runEvaluator({ ...runtime, request: { schema_version: '1.0', request_id, room_id,
    input_revision, operation: 'evaluator.evaluate', payload: { ...rest, idea } } });
}
