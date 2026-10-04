import { schema, table, t, SenderError, type InferSchema, type ReducerCtx, type ViewCtx } from 'spacetimedb/server';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// Raw records are deliberately private. Only identity-filtered views are public.
const owner = table({ name: 'idea_owner' }, { key: t.string().primaryKey(), identity: t.identity() });
const grant = table({ name: 'idea_grant' }, {
  key: t.string().primaryKey(), roomId: t.string(), identity: t.identity().index('btree'), role: t.string(),
});
const room = table({ name: 'idea_room_revision' }, {
  roomId: t.string().primaryKey(), inputRevision: t.u64(), authorizationRevision: t.u64(),
});
const job = table({ name: 'idea_job' }, {
  key: t.string().primaryKey(), roomId: t.string().index('btree'), requestId: t.string(), operation: t.string(),
  inputRevision: t.u64(), authorizationRevision: t.u64(), requestHash: t.string(), requestJson: t.string(),
  status: t.string(), responseJson: t.string(), claimant: t.option(t.identity()), attemptId: t.string(), leaseUntil: t.u64(),
});

// Authorized shared projection only. Never publish SQLite's raw rooms.state.
const board = table({ name: 'workflow_board' }, {
  roomId: t.string().primaryKey(), revision: t.u64(), snapshotJson: t.string(),
});
const spacetimedb = schema({ owner, grant, room, job, board });
export default spacetimedb;
type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type ReadCtx = ViewCtx<InferSchema<typeof spacetimedb>>;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
const pair = (left: string, right: string) => JSON.stringify([left, right]);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const reject = (code: string): never => { throw new SenderError(code); };
const object = (value: Json | undefined): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);

function canonical(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function parseObject(serialized: string): JsonObject {
  if (serialized.length > 1_000_000) reject('PAYLOAD_TOO_LARGE');
  let value: Json;
  try { value = JSON.parse(serialized) as Json; } catch { return reject('INVALID_JSON'); }
  if (!object(value)) return reject('INVALID_JSON');
  return value;
}

function roleFor(ctx: Ctx | ReadCtx, roomId: string): string | undefined {
  return ctx.db.grant.key.find(pair(roomId, ctx.sender.toHexString()))?.role;
}
function requireRole(ctx: Ctx, roomId: string, role: 'workflow' | 'worker') {
  if (roleFor(ctx, roomId) !== role) reject('UNAUTHORIZED');
}
function requireOwner(ctx: Ctx) {
  if (!ctx.db.owner.key.find('owner')?.identity.isEqual(ctx.sender)) reject('UNAUTHORIZED');
}
function currentRoom(ctx: Ctx, roomId: string, inputRevision: bigint, authorizationRevision: bigint) {
  const current = ctx.db.room.roomId.find(roomId);
  if (!current || current.inputRevision !== inputRevision || current.authorizationRevision !== authorizationRevision) reject('STALE_INPUT');
}

export const init = spacetimedb.init((ctx) => {
  ctx.db.owner.insert({ key: 'owner', identity: ctx.sender });
});

/** Owner provisions separate server workflow/worker identities; no self-registration. */
export const grantRoom = spacetimedb.reducer({ roomId: t.string(), identity: t.identity(), role: t.string() }, (ctx, args) => {
  requireOwner(ctx);
  if (!nonempty(args.roomId) || !['workflow', 'worker'].includes(args.role)) reject('INVALID_GRANT');
  const row = { key: pair(args.roomId, args.identity.toHexString()), ...args };
  if (ctx.db.grant.key.find(row.key)) ctx.db.grant.key.update(row);
  else ctx.db.grant.insert(row);
});

export const revokeRoom = spacetimedb.reducer({ roomId: t.string(), identity: t.identity() }, (ctx, args) => {
  requireOwner(ctx);
  ctx.db.grant.key.delete(pair(args.roomId, args.identity.toHexString()));
});

/** Workflow invokes this immediately when relevant shared state or consent changes. */
export const advanceRoomRevision = spacetimedb.reducer({
  roomId: t.string(), inputRevision: t.u64(), authorizationRevision: t.u64(),
}, (ctx, args) => {
  requireRole(ctx, args.roomId, 'workflow');
  if (args.inputRevision > BigInt(Number.MAX_SAFE_INTEGER) || args.authorizationRevision > BigInt(Number.MAX_SAFE_INTEGER)) reject('INVALID_REVISION');
  const previous = ctx.db.room.roomId.find(args.roomId);
  if (previous) {
    if (args.inputRevision < previous.inputRevision || args.authorizationRevision < previous.authorizationRevision) reject('STALE_INPUT');
    ctx.db.room.roomId.update(args);
  } else ctx.db.room.insert(args);
});

/** Only the trusted Workflow submits complete, already authorized/gated snapshots. */
export const enqueueIdea = spacetimedb.reducer({ requestJson: t.string(), authorizationRevision: t.u64() }, (ctx, args) => {
  const request = parseObject(args.requestJson);
  if (!nonempty(request.room_id) || !nonempty(request.request_id)
      || !['idea.generate', 'idea.revise'].includes(String(request.operation))
      || request.schema_version !== '1.0' || typeof request.input_revision !== 'number'
      || !Number.isSafeInteger(request.input_revision) || request.input_revision < 0
      || !object(request.payload) || !object(request.payload.shared_context)
      || !Array.isArray(request.payload.shared_context.sources)
      || !Array.isArray(request.payload.shared_context.discussion_history)
      || !Array.isArray(request.payload.shared_context.profiles)
      || !object(request.payload.room_context) || !Array.isArray(request.payload.room_context.constraints)) reject('INVALID_INPUT');
  const roomId = request.room_id as string;
  const requestId = request.request_id as string;
  const inputRevision = BigInt(request.input_revision as number);
  requireRole(ctx, roomId, 'workflow');
  currentRoom(ctx, roomId, inputRevision, args.authorizationRevision);
  const requestJson = canonical(request);
  const requestHash = bytesToHex(sha256(utf8ToBytes(requestJson)));
  const key = pair(roomId, requestId);
  const previous = ctx.db.job.key.find(key);
  if (previous) {
    if (previous.requestHash !== requestHash || previous.authorizationRevision !== args.authorizationRevision) reject('CONFLICT');
    return; // Exact logical task replay preserves its result and lease.
  }
  ctx.db.job.insert({
    key, roomId, requestId, operation: request.operation as string, inputRevision,
    authorizationRevision: args.authorizationRevision, requestHash, requestJson,
    status: 'queued', responseJson: '', claimant: undefined, attemptId: '', leaseUntil: 0n,
  });
});

/** Atomic lease prevents two workers starting one request; retries reuse attemptId. */
export const claimIdea = spacetimedb.reducer({ roomId: t.string(), requestId: t.string(), attemptId: t.string() }, (ctx, args) => {
  requireRole(ctx, args.roomId, 'worker');
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(args.attemptId)) reject('INVALID_ATTEMPT');
  const row = ctx.db.job.key.find(pair(args.roomId, args.requestId));
  if (!row) return reject('NOT_FOUND');
  currentRoom(ctx, row.roomId, row.inputRevision, row.authorizationRevision);
  if (row.status === 'completed') return;
  const now = ctx.timestamp.microsSinceUnixEpoch;
  if (row.status === 'running' && row.leaseUntil > now) {
    if (row.claimant?.isEqual(ctx.sender) && row.attemptId === args.attemptId) return;
    reject('IN_PROGRESS');
  }
  ctx.db.job.key.update({ ...row, status: 'running', claimant: ctx.sender, attemptId: args.attemptId,
    leaseUntil: now + 300_000_000n });
});

/** Worker validates full protocol first. Reducer rechecks identity, version and lease. */
export const commitIdea = spacetimedb.reducer({
  roomId: t.string(), requestId: t.string(), attemptId: t.string(), requestHash: t.string(),
  authorizationRevision: t.u64(), responseJson: t.string(),
}, (ctx, args) => {
  requireRole(ctx, args.roomId, 'worker');
  const row = ctx.db.job.key.find(pair(args.roomId, args.requestId));
  if (!row) return reject('NOT_FOUND');
  currentRoom(ctx, row.roomId, row.inputRevision, args.authorizationRevision);
  if (row.authorizationRevision !== args.authorizationRevision || row.requestHash !== args.requestHash) reject('CONFLICT');
  const response = parseObject(args.responseJson);
  const request = parseObject(row.requestJson);
  for (const key of ['schema_version', 'room_id', 'request_id', 'operation', 'input_revision']) {
    if (response[key] !== request[key]) reject('INVALID_OUTPUT');
  }
  if (!['ok', 'error'].includes(String(response.status)) || !object(response.data)
      || !Array.isArray(response.warnings) || response.warnings.some((warning) => typeof warning !== 'string')
      || (response.status === 'ok' && response.error !== null)
      || (response.status === 'error' && !object(response.error))) reject('INVALID_OUTPUT');
  const responseJson = canonical(response);
  if (row.status === 'completed') {
    if (row.responseJson !== responseJson) reject('CONFLICT');
    return; // Ambiguous commit acknowledgement may safely be retried unchanged.
  }
  if (row.status !== 'running' || !row.claimant?.isEqual(ctx.sender) || row.attemptId !== args.attemptId
      || row.leaseUntil <= ctx.timestamp.microsSinceUnixEpoch) reject('LEASE_EXPIRED');
  ctx.db.job.key.update({ ...row, status: 'completed', responseJson, leaseUntil: 0n });
});

/** Public view means callable, not world-readable: sender grants filter every row. */
export const myIdeaJobs = spacetimedb.view({ name: 'my_idea_jobs', public: true }, t.array(job.rowType), (ctx) => {
  const rows = [];
  for (const access of ctx.db.grant.identity.filter(ctx.sender)) {
    for (const row of ctx.db.job.roomId.filter(access.roomId)) {
      const current = ctx.db.room.roomId.find(row.roomId);
      if (!current || row.inputRevision !== current.inputRevision || row.authorizationRevision !== current.authorizationRevision) continue;
      if (access.role === 'workflow' || (access.role === 'worker'
          && (row.status === 'completed' || row.claimant?.isEqual(ctx.sender)))) rows.push(row);
    }
  }
  return rows;
});

/** Idempotent, monotonic outbox target. Workflow remains the state-machine authority. */
export const publishBoard = spacetimedb.reducer({ roomId: t.string(), revision: t.u64(),
  ideaRevision: t.u64(), snapshotJson: t.string() }, (ctx, args) => {
  requireRole(ctx, args.roomId, 'workflow');
  const snapshot = parseObject(args.snapshotJson);
  const allowed = ['room_id','revision','discussion_round','phase','mode','agent_runtime','room_context','config',
    'paused_reason','calls_started','difference','answers','votes','convergence_decision','candidates','evaluations',
    'reviews','candidate_history','selected_candidate_ref','shared_context','members','evaluation_details'];
  if (Object.keys(snapshot).some(k => !allowed.includes(k)) || snapshot.room_id !== args.roomId
      || snapshot.revision !== Number(args.revision)) reject('INVALID_BOARD');
  const previous = ctx.db.board.roomId.find(args.roomId);
  const snapshotJson = canonical(snapshot);
  if (previous && previous.revision > args.revision) return;
  if (previous?.revision === args.revision) {
    if (previous.snapshotJson !== snapshotJson) reject('CONFLICT');
    return;
  }
  const row = { roomId: args.roomId, revision: args.revision, snapshotJson };
  if (previous) ctx.db.board.roomId.update(row); else ctx.db.board.insert(row);
  const current = ctx.db.room.roomId.find(args.roomId);
  if (!current || current.inputRevision < args.ideaRevision) {
    const revision = { roomId: args.roomId, inputRevision: args.ideaRevision, authorizationRevision: current?.authorizationRevision ?? 0n };
    if (current) ctx.db.room.roomId.update(revision); else ctx.db.room.insert(revision);
  }
});

export const myWorkflowBoards = spacetimedb.view({ name: 'my_workflow_boards', public: true }, t.array(board.rowType), ctx => {
  const rows = [];
  for (const access of ctx.db.grant.identity.filter(ctx.sender)) {
    if (access.role !== 'workflow') continue;
    const row = ctx.db.board.roomId.find(access.roomId);
    if (row) rows.push(row);
  }
  return rows;
});

/** Only an explicit Workflow retry may clear a failed remote outcome. */
export const retryIdea = spacetimedb.reducer({ roomId: t.string(), requestId: t.string() }, (ctx, args) => {
  requireRole(ctx, args.roomId, 'workflow');
  const row = ctx.db.job.key.find(pair(args.roomId, args.requestId));
  if (!row) return reject('NOT_FOUND');
  currentRoom(ctx, row.roomId, row.inputRevision, row.authorizationRevision);
  if (row.status !== 'completed' || parseObject(row.responseJson).status !== 'error') return;
  ctx.db.job.key.update({ ...row, status: 'queued', responseJson: '', claimant: undefined, attemptId: '', leaseUntil: 0n });
});
