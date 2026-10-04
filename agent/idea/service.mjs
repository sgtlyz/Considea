import { Type } from '@earendil-works/pi-ai';
import { runAgent } from '../pi-base/base.mjs';
import { createIdeaDefinition, validateRequest, validateResponse } from './definition.mjs';
import { createSearchSession } from './search.mjs';
import { recallSharedMemory } from './memory.mjs';

const headerKeys = ['schema_version', 'request_id', 'room_id', 'operation', 'input_revision'];
const headers = request => Object.fromEntries(headerKeys.map(k => [k, request?.[k] ?? null]));
export const errorResponse = (request, code, message) => ({ ...headers(request), status: 'error', data: {},
  warnings: [], error: { code, message, retryable: ['MODEL_TIMEOUT', 'MODEL_ERROR', 'TOOL_UNAVAILABLE'].includes(code) },
  ...(request?.payload?.contract_version === '2.1' ? { research: { evidence: [], search_log: [] } } : {}) });
const toolResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: {} });

/** Trusted backend entry point. Authentication and atomic publication remain Workflow responsibilities. */
export async function runIdea({ request, runtime, searchProvider, memoryClient, onProgress = () => {}, onDiagnostic, signal,
  limits = {} } = {}) {
  if (!validateRequest(request)) return errorResponse(request, 'INVALID_INPUT', 'Invalid Idea request, references, or human routing context');
  if (signal?.aborted) return errorResponse(request, 'MODEL_ERROR', 'Idea request was cancelled before execution');
  // Copy before any asynchronous work: the caller cannot mutate an authorized snapshot mid-run.
  request = structuredClone(request);
  const { timeoutMs = 90_000, maxTurns = 6, maxToolCalls = 10, maxInputBytes = 100_000 } = limits;
  if (Object.keys(limits).some(k => !['timeoutMs', 'maxTurns', 'maxToolCalls', 'maxInputBytes'].includes(k)) ||
      ![[timeoutMs, 120_000], [maxTurns, 12], [maxToolCalls, 12], [maxInputBytes, 200_000]]
        .every(([n, max]) => Number.isSafeInteger(n) && n > 0 && n <= max)) {
    return errorResponse(request, 'CONFIG_ERROR', 'Invalid bounded Idea runtime limits');
  }
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > maxInputBytes) {
    return errorResponse(request, 'BUDGET_EXCEEDED', 'Shared context exceeds the configured input size; no history was silently removed');
  }
  if (!runtime?.model || typeof runtime.streamFn !== 'function') {
    return errorResponse(request, 'CONFIG_ERROR', 'Configure an explicit offline or live model runtime');
  }
  const research = request.payload.contract_version === '2.1';
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const warnings = [];
  let session, memoryCalls = 0;
  const attachResearch = response => {
    if (research) response.research = { evidence: structuredClone(session?.evidence ?? []), search_log: structuredClone(session?.searchLog ?? []) };
    return response;
  };
  try {
    session = research ? createSearchSession({ request, provider: searchProvider, signal: abort.signal }) : null;
    const memoryTools = memoryClient ? [{
      name: 'recall_shared_memory', label: 'Recall shared discussion',
      description: 'Recall previously shared preferences or tradeoffs in this room. Results are rechecked against the full authorized input. Cannot expand access. At most two calls.',
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 300 }) }, { additionalProperties: false }),
      execute: async (_id, args, toolSignal) => {
        if (!args || Object.keys(args).length !== 1 || typeof args.query !== 'string' || !args.query.trim() || args.query.length > 300) {
          return toolResult({ sources: [], warning: 'Invalid memory query' });
        }
        if (++memoryCalls > 2) return toolResult({ sources: [], warning: 'Memory query budget exhausted' });
        const recalled = await recallSharedMemory({ request, client: memoryClient, query: args.query, limit: 5,
          signal: toolSignal ? AbortSignal.any([toolSignal, abort.signal]) : abort.signal });
        warnings.push(...recalled.warnings);
        return toolResult(recalled);
      },
    }] : [];
    const definition = createIdeaDefinition({ createTools: () => [...(session?.tools ?? []), ...memoryTools] });
    // Never spread caller runtime over policy/definition/request: it contains only model transport.
    const streamFn = (model, context, options = {}) => runtime.streamFn(model, context, { ...options,
      signal: options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal });
    const response = await runAgent({ request, definition, model: runtime.model, streamFn,
      timeoutMs, maxTurns, maxToolCalls, onProgress, onDiagnostic,
      maxOutputRepairs: !research && !memoryClient ? 1 : 0 });
    if (signal?.aborted) return attachResearch(errorResponse(request, 'MODEL_ERROR', 'Idea request was cancelled'));
    if (abort.signal.aborted) return attachResearch(errorResponse(request, 'MODEL_TIMEOUT', 'Idea request exceeded its time limit'));
    if (response.status === 'error') return attachResearch(response);
    if (response.status !== 'ok') return attachResearch(errorResponse(request, 'INVALID_OUTPUT', 'Idea operations must return ok or error'));
    if (research) {
      const evidenceKeys = new Set(session.evidence.map(e => e.evidence_key));
      const drafts = request.operation === 'idea.generate' ? response.data.candidates.map(c => c.draft) : [response.data.draft];
      if (drafts.some(d => d.inspiration_refs.some(ref => !evidenceKeys.has(ref.evidence_key)))) {
        return attachResearch(errorResponse(request, 'INVALID_OUTPUT', 'Candidate cites external evidence that was not supplied or retrieved'));
      }
      if (request.payload.search_policy.required && drafts.some(d => d.inspiration_refs.length === 0)) {
        return attachResearch(errorResponse(request, 'TOOL_UNAVAILABLE', 'Required research must support every candidate; no unsupported candidate was published'));
      }
      response.research = { evidence: structuredClone(session.evidence), search_log: structuredClone(session.searchLog) };
      warnings.push(...session.warnings);
      if (request.payload.search_policy.enabled && session.searchLog.length === 0 && session.evidence.length === 0) {
        warnings.push('No external research was performed; novelty and market need remain unknown.');
      }
    }
    response.warnings = [...new Set([...response.warnings, ...warnings])];
    if (!validateResponse(request, response)) {
      return errorResponse(request, 'INVALID_OUTPUT', 'Final Idea response failed protocol or evidence-ledger validation');
    }
    return response;
  } catch {
    return attachResearch(errorResponse(request, abort.signal.aborted ? 'MODEL_TIMEOUT' : 'MODEL_ERROR',
      'Idea runtime failed; provider details are restricted to protected diagnostics'));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    abort.abort();
  }
}

/** Read-authorize-run-commit bridge; store.commitResult MUST recheck revisions atomically. */
export async function runIdeaFromStore({ store, roomId, requestId, operation, runtime, searchProvider, memoryClient, onProgress, limits, signal }) {
  const snapshot = await store.loadSnapshot({ roomId, requestId, operation, signal });
  if (snapshot?.request?.room_id !== roomId || snapshot.request.request_id !== requestId || snapshot.request.operation !== operation) {
    throw new Error('Authorized snapshot does not match the requested task');
  }
  signal?.throwIfAborted();
  if (!validateRequest(snapshot.request)) throw new Error('Stored request failed Idea validation');
  if (snapshot.response) {
    if (!validateResponse(snapshot.request, snapshot.response)) throw new Error('Stored response failed Idea protocol validation');
    return structuredClone(snapshot.response);
  }
  const response = await runIdea({ request: snapshot.request, runtime, searchProvider, memoryClient, onProgress, limits, signal });
  signal?.throwIfAborted();
  // The application stores errors as task outcomes, without advancing its workflow.
  return store.commitResult({ request: snapshot.request, response, authorizationRevision: snapshot.authorization_revision, signal });
}
