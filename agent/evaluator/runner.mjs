import { randomUUID } from 'node:crypto';
import { runAgent } from '../pi-base/base.mjs';
import { normalizeRequest, finalizeReport, incompleteDraft, error } from './contracts.mjs';
import { createSession } from './session.mjs';
import { createDefinition } from './definition.mjs';

export function errorResponse(request, code, message, retryable = false) {
  return { ...Object.fromEntries(['schema_version', 'request_id', 'room_id', 'operation', 'input_revision'].map(k => [k, request?.[k] ?? null])),
    status: 'error', data: {}, warnings: [], error: { code, message, retryable } };
}

export async function runEvaluator({ request, model, streamFn, retrieval, officialDomains = [],
  onProgress, maxTurns = 8, maxToolCalls = 30 } = {}) {
  let normalized, session;
  try {
    normalized = normalizeRequest(request);
    if (!model || typeof streamFn !== 'function' || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 20 ||
      !Number.isInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 50)
      throw error('CONFIG_ERROR', 'Provide a Pi model/streamFn and valid deployment runtime limits');
    session = createSession(normalized.payload, { retrieval, officialDomains });
    const result = await runAgent({ request: normalized, model, streamFn, onProgress,
      definition: createDefinition(normalized, session), timeoutMs: normalized.payload.tool_budget.timeout_ms, maxTurns, maxToolCalls });
    if (result.status === 'error') {
      if (!['MODEL_TIMEOUT', 'BUDGET_EXCEEDED'].includes(result.error.code)) return result;
      session.markIncomplete(); session.freeze();
      return { ...result, status: 'partial', error: null,
        data: finalizeReport(incompleteDraft(normalized.payload), normalized.payload, session.snapshot()),
        warnings: ['调查因运行预算耗尽而未完成；已保留实际证据，不能判定通过。'] };
    }
    if (result.status !== 'ok') session.markIncomplete();
    session.freeze(); const ledger = session.snapshot();
    return { ...result, status: ledger.incomplete ? 'partial' : 'ok',
      data: finalizeReport(result.data, normalized.payload, ledger),
      warnings: [...result.warnings, ...(ledger.incomplete ? ['调查存在未完成项，请查看 missing_information 与来源限制。'] : [])] };
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
