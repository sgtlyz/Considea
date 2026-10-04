import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DbConnection } from './bindings.mjs';
import { createSpacetimeContextStore } from '../../agent/idea/memory.mjs';
import { runIdeaFromStore } from '../../agent/idea/service.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeError = code => Object.assign(new Error(code), { code });
async function deadline(promise, ms = 20000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(safeError('SPACETIME_TIMEOUT')), ms);
  })]); } finally { clearTimeout(timer); }
}
async function waitFor(connection, read, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!connection.isActive) throw safeError('SPACETIME_DISCONNECTED');
    const value = read();
    if (value) return value;
    await delay(20);
  }
  throw safeError('SPACETIME_TIMEOUT');
}

export class SpaceClient {
  constructor(configPath, onBoard = () => {}) {
    this.configPath = configPath; this.onBoard = onBoard; this.connections = [];
    this.grants = new Map(); this.opening = null; this.generation = 0;
  }
  async open() {
    if (this.opening) return this.opening;
    const generation = ++this.generation;
    for (const connection of this.connections) { try { connection.disconnect(); } catch {} }
    this.connections = [];
    this.opening = this.initialize(generation).catch(error => { this.close(); throw error; });
    return this.opening;
  }
  async initialize(generation) {
    const config = JSON.parse(await readFile(this.configPath, 'utf8'));
    if (!config.uri || !config.database || !config.owner_token) throw safeError('SPACETIME_CONFIG_ERROR');
    const connect = token => deadline(new Promise((resolve, reject) => {
      const connection = DbConnection.builder().withUri(config.uri).withDatabaseName(config.database)
        .withToken(token).withConfirmedReads(true)
        .onConnect((ctx, identity, token) => resolve({ connection: ctx, identity, token }))
        .onConnectError(() => reject(safeError('SPACETIME_CONNECT_FAILED')))
        .onDisconnect(() => { if (generation === this.generation) { this.opening = null; this.grants.clear(); } }).build();
      this.connections.push(connection);
    }));
    this.owner = await connect(config.owner_token);
    this.workflow = await connect(config.workflow_token);
    this.worker = await connect(config.worker_token);
    if (!config.workflow_token || !config.worker_token) {
      config.workflow_token = this.workflow.token; config.worker_token = this.worker.token;
      const temp = this.configPath + '.tmp';
      await writeFile(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
      await rename(temp, this.configPath);
    }
    const workflow = this.workflow.connection;
    const changed = (_ctx, row) => this.onBoard(JSON.parse(row.snapshotJson));
    workflow.db.myWorkflowBoards.onInsert(changed);
    workflow.db.myWorkflowBoards.onUpdate((_ctx, _old, row) => changed(_ctx, row));
    await Promise.all([this.subscribe(workflow, ['SELECT * FROM my_workflow_boards', 'SELECT * FROM my_idea_jobs']),
      this.subscribe(this.worker.connection, ['SELECT * FROM my_idea_jobs'])]);
    for (const row of workflow.db.myWorkflowBoards.iter()) changed(null, row);
  }
  subscribe(connection, queries) {
    return deadline(new Promise((resolve, reject) => connection.subscriptionBuilder()
      .onApplied(resolve).onError(() => reject(safeError('SPACETIME_SUBSCRIPTION_FAILED'))).subscribe(queries)));
  }
  async ensureRoom(roomId) {
    await this.open();
    if (!this.grants.has(roomId)) {
      this.grants.set(roomId, (async () => {
        for (const [client, role] of [[this.workflow, 'workflow'], [this.worker, 'worker']]) {
          await deadline(this.owner.connection.reducers.grantRoom({ roomId, identity: client.identity, role }));
        }
      })().catch(error => { this.grants.delete(roomId); throw error; }));
    }
    await this.grants.get(roomId);
  }
  async publish({ room_id, revision, idea_revision, snapshot }) {
    await this.ensureRoom(room_id);
    const connection = this.workflow.connection;
    await deadline(connection.reducers.publishBoard({ roomId: room_id, revision: BigInt(revision),
      ideaRevision: BigInt(idea_revision), snapshotJson: JSON.stringify(snapshot) }));
    const row = await waitFor(connection, () => [...connection.db.myWorkflowBoards.iter()]
      .find(row => row.roomId === room_id && row.revision >= BigInt(revision)));
    return { revision: Number(row.revision) };
  }
  async idea({ request, attempt = 1, runtime }) {
    const roomId = request.room_id, requestId = request.request_id, authorizationRevision = 0n;
    await this.ensureRoom(roomId);
    const publisher = this.workflow.connection, worker = this.worker.connection;
    await deadline(publisher.reducers.advanceRoomRevision({ roomId,
      inputRevision: BigInt(request.input_revision), authorizationRevision }));
    await deadline(publisher.reducers.enqueueIdea({ requestJson: JSON.stringify(request), authorizationRevision }));
    if (attempt > 1) await deadline(publisher.reducers.retryIdea({ roomId, requestId }));
    const attemptId = randomUUID();
    const end = Date.now() + 330000;
    while (true) {
      try { await deadline(worker.reducers.claimIdea({ roomId, requestId, attemptId })); break; }
      catch (error) {
        if (!String(error.message).includes('IN_PROGRESS') || Date.now() > end) throw error;
        await delay(500);
      }
    }
    const current = () => [...worker.db.myIdeaJobs.iter()].find(row => row.roomId === roomId && row.requestId === requestId);
    let claimed;
    const store = createSpacetimeContextStore({
      loadSnapshot: async () => {
        claimed = await waitFor(worker, () => {
          const row = current();
          return row && (row.status === 'completed' || row.attemptId === attemptId) ? row : null;
        });
        return { request: JSON.parse(claimed.requestJson), authorization_revision: Number(claimed.authorizationRevision),
          ...(claimed.status === 'completed' ? { response: JSON.parse(claimed.responseJson) } : {}) };
      },
      commitResult: async ({ request, response, authorizationRevision }) => {
        await deadline(worker.reducers.commitIdea({ roomId, requestId, attemptId, requestHash: claimed.requestHash,
          authorizationRevision: BigInt(authorizationRevision), responseJson: JSON.stringify(response) }));
        const row = await waitFor(worker, () => { const row = current(); return row?.status === 'completed' ? row : null; });
        return JSON.parse(row.responseJson);
      },
    });
    // Mem0 remains disabled. All input is the Workflow-authorized request snapshot.
    return runIdeaFromStore({ store, roomId, requestId, operation: request.operation, runtime });
  }
  close() {
    this.generation++;
    for (const connection of this.connections) { try { connection.disconnect(); } catch {} }
    this.connections = []; this.opening = null; this.grants.clear();
  }
}
