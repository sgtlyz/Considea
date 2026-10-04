import { createHash } from 'node:crypto';

// Fixed origins prevent a model-supplied endpoint receiving the server's API key.
const ENDPOINTS = Object.freeze({
  search: 'https://api.mem0.ai/v3/memories/search/',
  add: 'https://api.mem0.ai/v3/memories/add/',
});
const SOURCE_KINDS = new Set([
  'profile_item', 'difference', 'difference_answer', 'convergence_decision',
  'human_review', 'evaluation', 'constraint',
]);
const OPERATIONS = new Set(['idea.generate', 'idea.revise']);
const ENVELOPE = ['schema_version', 'request_id', 'room_id', 'operation', 'input_revision'];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export class MemoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
  }
}

function invalid(message) {
  throw new MemoryError('INVALID_INPUT', message);
}

function copySource(source) {
  if (!isObject(source) || !nonempty(source.source_id) || !SOURCE_KINDS.has(source.kind)
      || !isObject(source.object_ref) || !nonempty(source.object_ref.id)
      || !Number.isSafeInteger(source.object_ref.version) || source.object_ref.version < 1
      || !(source.member_id === null || nonempty(source.member_id))
      || !(source.discussion_round === null || (Number.isSafeInteger(source.discussion_round) && source.discussion_round >= 1))
      || !nonempty(source.text)) invalid('Shared source is incomplete or invalid.');
  // Never propagate unexpected private fields, provider text, or arbitrary metadata.
  return {
    source_id: source.source_id,
    kind: source.kind,
    object_ref: { id: source.object_ref.id, version: source.object_ref.version },
    member_id: source.member_id,
    discussion_round: source.discussion_round,
    text: source.text,
  };
}

function sharedSources(request) {
  if (!isObject(request) || !nonempty(request.room_id) || !nonempty(request.request_id)
      || !OPERATIONS.has(request.operation) || !revision(request.input_revision)
      || !Array.isArray(request.payload?.shared_context?.sources)) {
    invalid('Memory requires a complete authorized Idea request and shared source directory.');
  }
  const sources = request.payload.shared_context.sources.map(copySource);
  if (new Set(sources.map((source) => source.source_id)).size !== sources.length) {
    invalid('Shared source IDs must be unique.');
  }
  return sources;
}

/** This scope is a namespace, not an authorization credential. Call from trusted code. */
export function createRoomMemoryScope(roomId) {
  if (!nonempty(roomId)) invalid('A backend-authorized room ID is required.');
  return Object.freeze({
    room_id: roomId,
    user_id: `mhacks-room:${Buffer.from(roomId, 'utf8').toString('base64url')}`,
    agent_id: 'idea-generator',
    visibility: 'team_shared',
  });
}

function validateScope(scope) {
  const expected = createRoomMemoryScope(scope?.room_id);
  if (Object.keys(expected).some((key) => scope[key] !== expected[key])) {
    invalid('Memory scope must be the fixed shared namespace for the authorized room.');
  }
  return expected;
}

function sourceMetadata(scope, source) {
  return {
    room_id: scope.room_id,
    visibility: 'team_shared',
    source_id: source.source_id,
    object_ref: { ...source.object_ref },
    content_sha256: sha256(source.text),
  };
}

function checkedLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) invalid('Memory limit must be an integer from 1 to 20.');
  return limit;
}

function safeMetadata(metadata) {
  if (!isObject(metadata)) return {};
  const ref = metadata.object_ref;
  return {
    room_id: typeof metadata.room_id === 'string' ? metadata.room_id : null,
    visibility: typeof metadata.visibility === 'string' ? metadata.visibility : null,
    source_id: typeof metadata.source_id === 'string' ? metadata.source_id : null,
    object_ref: isObject(ref) ? { id: ref.id, version: ref.version } : null,
    content_sha256: typeof metadata.content_sha256 === 'string' ? metadata.content_sha256 : null,
  };
}

async function readJsonBounded(response, signal) {
  const maximumBytes = 262_144;
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    response.body?.cancel?.().catch(() => {});
    throw new MemoryError('MEMORY_INVALID_RESPONSE', 'Memory response exceeds the size limit.');
  }
  if (!response.body?.getReader) throw new MemoryError('MEMORY_INVALID_RESPONSE', 'Memory response is not a readable stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new MemoryError('MEMORY_ABORTED', 'Memory operation was cancelled or timed out.');
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        cancel();
        throw new MemoryError('MEMORY_INVALID_RESPONSE', 'Memory response exceeds the size limit.');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join(''));
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Server-only Mem0 Platform client. No calls are made until search/add is invoked. */
export function createMem0Client({ apiKey, fetch: fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  if (!nonempty(apiKey) || /[\r\n]/u.test(apiKey)) throw new MemoryError('CONFIG_ERROR', 'A valid server-side MEM0_API_KEY is required.');
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new MemoryError('CONFIG_ERROR', 'Mem0 requires fetch and a timeout from 1 to 60000 milliseconds.');
  }

  async function post(operation, body, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let onAbort;
    try {
      if (combined.aborted) throw new MemoryError('MEMORY_ABORTED', 'Memory operation was cancelled.');
      const cancelled = new Promise((_, reject) => {
        onAbort = () => reject(new MemoryError(operation === 'add' ? 'MEMORY_OUTCOME_UNKNOWN' : 'MEMORY_ABORTED',
          operation === 'add' ? 'Memory write outcome is unknown; reconcile before retrying.' : 'Memory operation was cancelled or timed out.'));
        combined.addEventListener('abort', onAbort, { once: true });
      });
      const work = async () => {
        const response = await fetchImpl(ENDPOINTS[operation], {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: combined,
        });
        if (combined.aborted) {
          response.body?.cancel?.().catch(() => {});
          throw new MemoryError('MEMORY_ABORTED', 'Memory operation was cancelled or timed out.');
        }
        if (!response.ok) {
        // Do not include provider bodies, URLs, exceptions, or Authorization headers.
        const status = Number.isInteger(response.status) ? response.status : 0;
        throw new MemoryError(operation === 'add' && status >= 500 ? 'MEMORY_OUTCOME_UNKNOWN' : 'MEMORY_UNAVAILABLE',
          `Memory provider rejected the request (HTTP ${status}).`);
        }
        const result = await readJsonBounded(response, combined);
        if (!isObject(result)) throw new MemoryError('MEMORY_INVALID_RESPONSE', 'Memory provider returned an invalid response.');
        return result;
      };
      return await Promise.race([work(), cancelled]);
    } catch (error) {
      if (operation === 'add' && error instanceof MemoryError && error.code === 'MEMORY_INVALID_RESPONSE') {
        throw new MemoryError('MEMORY_OUTCOME_UNKNOWN', 'Memory write receipt is invalid; reconcile before retrying.');
      }
      if (error instanceof MemoryError) throw error;
      if (operation === 'add') throw new MemoryError('MEMORY_OUTCOME_UNKNOWN', 'Memory write outcome is unknown; reconcile before retrying.');
      throw new MemoryError(combined.aborted ? 'MEMORY_ABORTED' : 'MEMORY_UNAVAILABLE',
        combined.aborted ? 'Memory operation was cancelled or timed out.' : 'Memory provider is unavailable.');
    } finally {
      clearTimeout(timer);
      if (onAbort) combined.removeEventListener('abort', onAbort);
    }
  }

  return Object.freeze({
    async search({ scope, query, limit = 5, signal } = {}) {
      const room = validateScope(scope);
      if (!nonempty(query) || query.length > 2_000) invalid('Memory query must contain 1 to 2000 characters.');
      checkedLimit(limit);
      const data = await post('search', {
        query,
        filters: { AND: [{ user_id: room.user_id }, { agent_id: room.agent_id }] },
        metadata: { room_id: room.room_id, visibility: room.visibility },
        top_k: limit,
      }, signal);
      if (!Array.isArray(data.results)) throw new MemoryError('MEMORY_INVALID_RESPONSE', 'Memory search results are missing.');
      return { results: data.results.slice(0, limit).filter(isObject).map((hit) => ({
        id: nonempty(hit.id) ? hit.id : null,
        metadata: safeMetadata(hit.metadata),
      })) };
    },
    async add({ scope, source, signal } = {}) {
      const room = validateScope(scope);
      const approved = copySource(source);
      const data = await post('add', {
        user_id: room.user_id,
        agent_id: room.agent_id,
        messages: [{ role: 'user', content: approved.text }],
        infer: false,
        metadata: sourceMetadata(room, approved),
      }, signal);
      if (data.status === 'FAILED') throw new MemoryError('MEMORY_UNAVAILABLE', 'Memory provider reported a failed write.');
      const memoryIds = Array.isArray(data.results)
        ? data.results.filter(isObject).map((item) => item.id).filter(nonempty) : [];
      const eventId = nonempty(data.event_id) ? data.event_id : null;
      if (data.status === 'PENDING' && eventId) return { status: 'pending', event_id: eventId, memory_ids: memoryIds };
      if (memoryIds.length > 0) return { status: 'succeeded', event_id: eventId, memory_ids: memoryIds };
      // An acknowledged write without a mapping must be reconciled, never blindly repeated.
      throw new MemoryError('MEMORY_OUTCOME_UNKNOWN', 'Memory provider did not return a usable write receipt; reconcile before retrying.');
    },
  });
}

/** Retrieval only ranks sources already authorized in the full current snapshot. */
export async function recallSharedMemory({ request, client, query, limit = 5, signal } = {}) {
  const sources = sharedSources(request);
  checkedLimit(limit);
  if (!client || typeof client.search !== 'function') {
    return { sources: [], warnings: ['Long-term memory is unavailable; the complete shared input remains available.'] };
  }
  const directory = new Map(sources.map((source) => [source.source_id, source]));
  try {
    const result = await client.search({ scope: createRoomMemoryScope(request.room_id), query, limit, signal });
    if (!Array.isArray(result?.results)) throw new Error('Invalid memory response');
    const recalled = [];
    const seen = new Set();
    let rejected = false;
    for (const hit of result.results.slice(0, limit)) {
      const metadata = hit?.metadata;
      const source = directory.get(metadata?.source_id);
      if (!source || metadata.room_id !== request.room_id || metadata.visibility !== 'team_shared'
          || metadata.object_ref?.id !== source.object_ref.id
          || metadata.object_ref?.version !== source.object_ref.version
          || metadata.content_sha256 !== sha256(source.text)) {
        rejected = true;
        continue;
      }
      if (!seen.has(source.source_id)) {
        // The provider's memory text and metadata never enter the model context.
        recalled.push(copySource(source));
        seen.add(source.source_id);
      }
    }
    return {
      sources: recalled,
      warnings: rejected ? ['Some memory matches were excluded because they are outside the current authorized source snapshot.'] : [],
    };
  } catch {
    return { sources: [], warnings: ['Long-term memory retrieval failed; the complete shared input remains available.'] };
  }
}

function mappingKey(roomId, source) {
  return sha256(JSON.stringify([roomId, source.source_id, source.object_ref.id, source.object_ref.version, sha256(source.text)]));
}

/**
 * Trusted background-worker helper, never an LLM tool. Persist mappings in a durable
 * outbox around each attempt. This function alone cannot guarantee exactly-once writes.
 */
export async function syncSharedSources({ request, client, knownMappings = [], signal } = {}) {
  const sources = sharedSources(request);
  if (!client || typeof client.add !== 'function') throw new MemoryError('CONFIG_ERROR', 'Memory synchronization requires a server-side client.');
  if (!Array.isArray(knownMappings)) invalid('Known memory mappings must be an array.');
  const scope = createRoomMemoryScope(request.room_id);
  const mappings = [];
  const warnings = [];
  for (const source of sources) {
    const key = mappingKey(request.room_id, source);
    const existing = knownMappings.find((mapping) => mapping?.key === key
      && ['succeeded', 'pending', 'unknown'].includes(mapping.status));
    if (existing) {
      mappings.push(structuredClone(existing));
      continue;
    }
    if (signal?.aborted) {
      warnings.push('Memory synchronization was cancelled; remaining sources were not submitted.');
      break;
    }
    const mapping = { key, room_id: request.room_id, source_id: source.source_id, object_ref: { ...source.object_ref }, content_sha256: sha256(source.text) };
    try {
      const receipt = await client.add({ scope, source: copySource(source), signal });
      if (!['succeeded', 'pending'].includes(receipt?.status)) throw new Error('Unrecognized receipt');
      mappings.push({ ...mapping, status: receipt.status, event_id: receipt.event_id ?? null, memory_ids: receipt.memory_ids ?? [] });
    } catch {
      // The remote write might have succeeded before the connection failed.
      mappings.push({ ...mapping, status: 'unknown', event_id: null, memory_ids: [] });
      warnings.push('A memory write could not be confirmed; reconcile its mapping before retrying.');
      break;
    }
  }
  return { mappings, warnings };
}

/**
 * Bind the application's authenticated projection and transactional reducer SDK.
 * This adapter does not invent tables, deploy a database, or replace server checks.
 */
export function createSpacetimeContextStore({ loadSnapshot, commitResult } = {}) {
  if (typeof loadSnapshot !== 'function' || typeof commitResult !== 'function') {
    throw new MemoryError('CONFIG_ERROR', 'SpacetimeDB requires authenticated loadSnapshot and transactional commitResult backend callbacks.');
  }
  return Object.freeze({
    async loadSnapshot({ roomId, requestId, operation, signal } = {}) {
      if (!nonempty(roomId) || !nonempty(requestId) || !OPERATIONS.has(operation)) invalid('A room, request ID, and Idea operation are required.');
      const snapshot = await loadSnapshot({ roomId, requestId, operation, signal });
      if (!isObject(snapshot) || !revision(snapshot.authorization_revision)) invalid('The backend must return an authorization revision.');
      const request = snapshot.request;
      sharedSources(request);
      if (request.room_id !== roomId || request.request_id !== requestId || request.operation !== operation) {
        invalid('The backend snapshot does not match the requested room and operation.');
      }
      if (!Array.isArray(request.payload.shared_context.profiles)
          || !Array.isArray(request.payload.shared_context.discussion_history)
          || !Array.isArray(request.payload.room_context?.constraints)) invalid('The backend must provide complete shared history and current constraints.');
      if (snapshot.response !== undefined && snapshot.response !== null
          && (!isObject(snapshot.response) || ENVELOPE.some((field) => snapshot.response[field] !== request[field]))) {
        invalid('The cached response envelope does not match its authorized request.');
      }
      return structuredClone({ request, authorization_revision: snapshot.authorization_revision,
        ...(snapshot.response ? { response: snapshot.response } : {}) });
    },
    async commitResult({ request, response, authorizationRevision, signal } = {}) {
      sharedSources(request);
      if (!revision(authorizationRevision)) invalid('Committing a result requires the snapshot authorization revision.');
      if (!isObject(response) || ENVELOPE.some((field) => response[field] !== request[field])) {
        invalid('The response envelope does not match its authorized request.');
      }
      // The reducer must recheck current authorization, revisions, input hash, and
      // deduplication atomically. A caller-side check cannot prevent these races.
      return commitResult({ request: structuredClone(request), response: structuredClone(response), authorizationRevision, signal });
    },
  });
}
