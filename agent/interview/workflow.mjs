import { randomUUID } from 'node:crypto';
import { runInterview, emptyCoverage } from './service.mjs';
import definition from './definition.mjs';

export class WorkflowError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const check = (condition, code, message) => { if (!condition) throw new WorkflowError(code, message); };

/** Local development harness. No HTTP/authentication/database; production caller owns those. */
export class InterviewWorkflow {
  #sessions = new Map();
  #busy = new Set();
  constructor({ runtimeFor, runner = runInterview } = {}) { this.runtimeFor = runtimeFor; this.runner = runner; }

  createSession({ room_config, member_id, mode = 'initial', followup_task = null, shared_context = null, profile = null }) {
    const payload = { room_config: structuredClone(room_config),
      private_interview: { member_id, mode, round_index: 0, messages: [], coverage: emptyCoverage() },
      followup_task: structuredClone(followup_task), shared_context: structuredClone(shared_context),
      ...(profile ? { profile: structuredClone(profile) } : {}) };
    check(definition.operations['interview.turn'].validateInput(payload), 'INVALID_INPUT', 'Invalid member session');
    const session_id = randomUUID();
    this.#sessions.set(session_id, { session_id, revision: 0, status: 'ready', payload,
      questions: [], draft: null, shared: profile ? structuredClone(profile) : null });
    return this.getPrivate(session_id);
  }

  #get(id) { const s = this.#sessions.get(id); check(s, 'NOT_FOUND', 'Unknown session'); return s; }
  #editable(id, revision) {
    const s = this.#get(id);
    check(!this.#busy.has(id), 'BUSY', 'A model operation is already running');
    check(revision === s.revision, 'STALE_REVISION', 'Refresh the session before editing');
    return s;
  }
  getPrivate(id) { return structuredClone(this.#get(id)); }
  getShared(id) { return structuredClone(this.#get(id).shared); }
  getProgress(id) {
    const s = this.#get(id);
    return { session_id: id, revision: s.revision, status: this.#busy.has(id) ? 'running' : s.status,
      answered_rounds: s.payload.private_interview.round_index };
  }

  async #invoke(id, revision, operation) {
    const s = this.#editable(id, revision);
    this.#busy.add(id);
    try {
      const request = { schema_version: '1.0', request_id: randomUUID(), room_id: s.payload.room_config.room_id,
        operation, input_revision: s.revision, payload: structuredClone(s.payload) };
      const runtime = this.runtimeFor ? await this.runtimeFor(operation) : undefined;
      const response = await this.runner({ request, runtime });
      if (response.status === 'error') return { response, session: this.getPrivate(id) };
      check(definition.operations[operation].validateOutput(response.data, request.payload),
        'INVALID_OUTPUT', 'Agent returned an invalid operation result');
      if (operation === 'interview.turn') {
        const d = response.data;
        s.payload.private_interview.coverage = structuredClone(d.coverage);
        s.questions = d.questions.map((q, i) => ({ ...q, question_id: `${id}:${d.round_index}:${i + 1}` }));
        s.status = d.ready_to_summarize ? 'ready_to_summarize' : 'awaiting_answer';
        if (s.questions.length) s.payload.private_interview.messages.push({ role: 'assistant',
          content: s.questions.map(q => q.text).join('\n') });
      } else if (response.status !== 'needs_input') {
        s.draft = structuredClone(response.data.draft_profile);
        s.status = 'awaiting_approval';
      }
      s.revision++;
      return { response, session: this.getPrivate(id) };
    } finally { this.#busy.delete(id); }
  }

  next(id, { expectedRevision }) {
    const s = this.#editable(id, expectedRevision);
    check(s.status === 'ready', 'INVALID_STATE', 'Answer the pending questions or finish first');
    return this.#invoke(id, expectedRevision, 'interview.turn');
  }

  answer(id, { expectedRevision, text }) {
    const s = this.#editable(id, expectedRevision);
    check(s.status === 'awaiting_answer', 'INVALID_STATE', 'No question batch is awaiting an answer');
    check(typeof text === 'string' && text.trim().length > 0 && text.length <= 16_000,
      'INVALID_INPUT', 'Provide a nonempty answer up to 16000 characters');
    s.payload.private_interview.messages.push({ role: 'user', content: text });
    s.payload.private_interview.round_index++;
    s.questions = [];
    s.status = 'ready';
    s.revision++;
    return this.getPrivate(id);
  }

  finish(id, { expectedRevision }) {
    const s = this.#editable(id, expectedRevision);
    check(['ready', 'awaiting_answer', 'ready_to_summarize'].includes(s.status), 'INVALID_STATE', 'Session already finished');
    s.payload.private_interview.finish_requested = true;
    s.questions = [];
    s.status = 'ready_to_summarize';
    s.revision++;
    return this.getPrivate(id);
  }

  summarize(id, { expectedRevision }) {
    const s = this.#editable(id, expectedRevision);
    check(['ready', 'ready_to_summarize'].includes(s.status), 'INVALID_STATE', 'Finish or answer pending questions first');
    return this.#invoke(id, expectedRevision, 'interview.summarize');
  }

  approve(id, { expectedRevision, draft }) {
    const s = this.#editable(id, expectedRevision);
    check(s.status === 'awaiting_approval', 'INVALID_STATE', 'No summary is awaiting approval');
    const data = { member_id: s.payload.private_interview.member_id, draft_profile: draft, changes: [], unknowns: draft?.unknowns };
    check(definition.operations['interview.summarize'].validateOutput(data, s.payload),
      'INVALID_INPUT', 'Edited draft failed schema validation');
    s.shared = { ...structuredClone(draft), profile_id: s.shared?.profile_id ?? randomUUID(),
      version: (s.shared?.version ?? 0) + 1, approved_at: new Date().toISOString(),
      items: draft.items.map(item => ({ ...item, item_id: randomUUID() })) };
    s.draft = structuredClone(draft);
    s.status = 'approved';
    s.revision++;
    return this.getShared(id);
  }
}
