import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Real SDK wrappers + real module reducers; only the native host import and DB
// context are mocked. This does not exercise a running SpacetimeDB server.
const consoleBeforeImport = globalThis.console;
const hostShim = 'data:text/javascript,export const moduleHooks = Symbol.for("test.moduleHooks"); export function row_iter_bsatn_close() {}';
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('spacetime:sys@')) return { url: hostShim, shortCircuit: true };
  return next(specifier, context);
} });
const mod = await import('./src/index.ts');
globalThis.console = consoleBeforeImport;
hook.deregister();

const identity = (id) => ({ toHexString: () => id, isEqual: (other) => other?.toHexString() === id });
const owner = identity('owner');
const workflow = identity('workflow');
const workerA = identity('worker-a');
const workerB = identity('worker-b');
const outsider = identity('outsider');
const attemptA = 'attempt_worker_a_123';
const attemptB = 'attempt_worker_b_456';

function table(primaryKey, indexKeys = []) {
  const rows = new Map();
  const result = {
    insert(row) { assert.equal(rows.has(row[primaryKey]), false); rows.set(row[primaryKey], { ...row }); },
    iter() { return rows.values(); },
    [primaryKey]: {
      find(key) { const row = rows.get(key); return row && { ...row }; },
      update(row) { assert.equal(rows.has(row[primaryKey]), true); rows.set(row[primaryKey], { ...row }); },
      delete(key) { return rows.delete(key); },
    },
  };
  for (const key of indexKeys) result[key] = { filter(value) {
    return [...rows.values()].filter((row) => row[key]?.isEqual ? row[key].isEqual(value) : row[key] === value);
  } };
  return result;
}

function fixture() {
  const db = { owner: table('key'), grant: table('key', ['identity']), room: table('roomId'), job: table('key', ['roomId']), board: table('roomId') };
  let now = 1_000_000n;
  const ctx = (sender) => ({ db, sender, timestamp: { microsSinceUnixEpoch: now } });
  const request = {
    schema_version: '1.0', room_id: 'room-1', request_id: 'request-1', operation: 'idea.generate', input_revision: 7,
    payload: { room_context: { constraints: [] }, shared_context: { sources: [], profiles: [], discussion_history: [] } },
  };
  mod.init(ctx(owner));
  for (const [id, role] of [[workflow, 'workflow'], [workerA, 'worker'], [workerB, 'worker']]) {
    mod.grantRoom(ctx(owner), { roomId: 'room-1', identity: id, role });
  }
  mod.advanceRoomRevision(ctx(workflow), { roomId: 'room-1', inputRevision: 7n, authorizationRevision: 3n });
  const enqueue = (value = request) => mod.enqueueIdea(ctx(workflow), { requestJson: JSON.stringify(value), authorizationRevision: 3n });
  enqueue();
  const row = () => db.job.key.find(JSON.stringify(['room-1', 'request-1']));
  const claim = (id = workerA, attemptId = attemptA) => mod.claimIdea(ctx(id), { roomId: 'room-1', requestId: 'request-1', attemptId });
  const response = (status = 'ok') => ({ schema_version: '1.0', room_id: 'room-1', request_id: 'request-1', operation: 'idea.generate', input_revision: 7,
    status, data: {}, warnings: [], error: status === 'error' ? { code: 'MODEL_ERROR', message: 'Model failed', retryable: true } : null });
  const commit = ({ id = workerA, attemptId = attemptA, result = response(), authorizationRevision = 3n, requestHash = row().requestHash } = {}) => mod.commitIdea(ctx(id), {
    roomId: 'room-1', requestId: 'request-1', attemptId, requestHash, authorizationRevision, responseJson: JSON.stringify(result),
  });
  return { db, ctx, request, enqueue, row, claim, response, commit, setNow: (value) => { now = value; } };
}

test('only owner grants access; workflow enqueues; workers cannot fabricate jobs', () => {
  const f = fixture();
  assert.throws(() => mod.grantRoom(f.ctx(outsider), { roomId: 'room-1', identity: outsider, role: 'workflow' }), /UNAUTHORIZED/);
  assert.throws(() => mod.enqueueIdea(f.ctx(workerA), { requestJson: JSON.stringify({ ...f.request, request_id: 'forged' }), authorizationRevision: 3n }), /UNAUTHORIZED/);
  assert.throws(() => f.claim(outsider), /UNAUTHORIZED/);
  assert.deepEqual(mod.myIdeaJobs(f.ctx(outsider)), []);
  assert.deepEqual(mod.myIdeaJobs(f.ctx(workerA)), []);
  assert.equal(mod.myIdeaJobs(f.ctx(workflow)).length, 1);
});

test('same request ID replay is idempotent; changed content conflicts even with same revision', () => {
  const f = fixture();
  const hash = f.row().requestHash;
  f.enqueue();
  assert.equal([...f.db.job.iter()].length, 1);
  assert.equal(f.row().requestHash, hash);
  const changed = structuredClone(f.request);
  changed.payload.room_context.constraints = [{ text: 'changed' }];
  assert.throws(() => f.enqueue(changed), /CONFLICT/);
  assert.equal(f.row().requestHash, hash);
});

test('only one attempt may hold a lease, including concurrent requests from one identity', () => {
  const f = fixture();
  f.claim();
  const first = f.row();
  f.claim(); // Same attempt may retry an ambiguous claim acknowledgement.
  assert.equal(f.row().leaseUntil, first.leaseUntil);
  assert.throws(() => f.claim(workerB, attemptB), /IN_PROGRESS/);
  assert.throws(() => f.claim(workerA, attemptB), /IN_PROGRESS/);
  assert.equal(mod.myIdeaJobs(f.ctx(workerA)).length, 1);
  assert.deepEqual(mod.myIdeaJobs(f.ctx(workerB)), []);
});

test('expired attempt cannot commit after a new worker acquires the lease', () => {
  const f = fixture();
  f.claim();
  f.setNow(f.row().leaseUntil);
  assert.throws(() => f.commit(), /LEASE_EXPIRED/);
  f.claim(workerB, attemptB);
  assert.throws(() => f.commit(), /LEASE_EXPIRED/);
  f.commit({ id: workerB, attemptId: attemptB });
  assert.equal(f.row().status, 'completed');
});

test('authorization revocation hides snapshots and blocks old result commits', () => {
  const f = fixture();
  f.claim();
  mod.advanceRoomRevision(f.ctx(workflow), { roomId: 'room-1', inputRevision: 7n, authorizationRevision: 4n });
  assert.deepEqual(mod.myIdeaJobs(f.ctx(workerA)), []);
  assert.deepEqual(mod.myIdeaJobs(f.ctx(workflow)), []);
  assert.throws(() => f.commit(), /STALE_INPUT/);
  assert.throws(() => f.commit({ authorizationRevision: 4n }), /CONFLICT/);
  assert.throws(() => f.claim(), /STALE_INPUT/);
  assert.equal(f.row().status, 'running');
});

test('removed worker grants block reads, claims, and writes immediately', () => {
  const f = fixture();
  f.claim();
  mod.revokeRoom(f.ctx(owner), { roomId: 'room-1', identity: workerA });
  assert.deepEqual(mod.myIdeaJobs(f.ctx(workerA)), []);
  assert.throws(() => f.commit(), /UNAUTHORIZED/);
  assert.throws(() => f.claim(), /UNAUTHORIZED/);
});

test('completed response replay is stable and conflicting overwrite is rejected', () => {
  const f = fixture();
  f.claim();
  assert.throws(() => f.commit({ requestHash: 'not-the-request-hash' }), /CONFLICT/);
  assert.throws(() => f.commit({ result: { ...f.response(), input_revision: 6 } }), /INVALID_OUTPUT/);
  f.commit();
  const original = f.row().responseJson;
  f.commit();
  f.claim(workerB, attemptB); // Cached request is read without a new model lease.
  assert.equal(f.row().responseJson, original);
  assert.throws(() => f.commit({ result: { ...f.response(), warnings: ['different result'] } }), /CONFLICT/);
});

test('error outcomes are stored for audit without advancing product workflow', () => {
  const f = fixture();
  f.claim();
  f.commit({ result: f.response('error') });
  assert.equal(JSON.parse(f.row().responseJson).status, 'error');
  assert.deepEqual(f.db.room.roomId.find('room-1'), { roomId: 'room-1', inputRevision: 7n, authorizationRevision: 3n });
  assert.equal([...f.db.job.iter()].length, 1);
});

test('board projection is workflow-only, monotonic, rejects private fields and invalidates stopped work', () => {
  const f=fixture();
  const publish=(revision, extra={})=>mod.publishBoard(f.ctx(workflow), {roomId:'room-1', revision:BigInt(revision),
    ideaRevision:9n, snapshotJson:JSON.stringify({room_id:'room-1',revision,phase:'ended',...extra})});
  assert.throws(()=>publish(10,{private:{messages:['secret']}}),/INVALID_BOARD/);
  publish(10); publish(9); publish(10);
  assert.equal(mod.myWorkflowBoards(f.ctx(workflow))[0].revision,10n);
  assert.deepEqual(mod.myWorkflowBoards(f.ctx(workerA)),[]);
  assert.deepEqual(mod.myWorkflowBoards(f.ctx(outsider)),[]);
  assert.throws(()=>publish(10,{phase:'interviewing'}),/CONFLICT/);
  assert.throws(()=>f.claim(),/STALE_INPUT/);
  assert.equal(f.db.room.roomId.find('room-1').authorizationRevision,3n);
});
test('only workflow retries error outcomes and cannot clear successful results',()=>{
  const f=fixture();f.claim();f.commit({result:f.response('error')});
  const args={roomId:'room-1',requestId:'request-1'};
  assert.throws(()=>mod.retryIdea(f.ctx(workerA),args),/UNAUTHORIZED/);
  mod.retryIdea(f.ctx(workflow),args);assert.equal(f.row().status,'queued');
  f.claim();f.commit();mod.retryIdea(f.ctx(workflow),args);
  assert.equal(f.row().status,'completed');assert.equal(JSON.parse(f.row().responseJson).status,'ok');
});


test('native evaluator reports survive board publication without allowing private root fields',()=>{
  const f=fixture();
  const details={'candidate-1':{report_schema_version:'1.2',candidate_id:'candidate-1',candidate_version:2,
    passed:false,tests:{novelty:{result:'insufficient_evidence'},feasibility:{result:'pass'}},evidence:[]}};
  const snapshot={room_id:'room-1',revision:11,phase:'awaiting_review',evaluation_details:details};
  const publish=snapshot=>mod.publishBoard(f.ctx(workflow),{roomId:'room-1',revision:11n,ideaRevision:7n,snapshotJson:JSON.stringify(snapshot)});
  publish(snapshot);publish(snapshot);
  assert.deepEqual(JSON.parse(mod.myWorkflowBoards(f.ctx(workflow))[0].snapshotJson).evaluation_details,details);
  assert.throws(()=>publish({...snapshot,private:{messages:['secret']}}),/INVALID_BOARD/);
  assert.deepEqual(mod.myWorkflowBoards(f.ctx(outsider)),[]);
});
