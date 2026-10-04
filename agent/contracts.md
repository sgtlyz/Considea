# Workflow–agent contracts

Executable shapes live in [protocol.schema.json](interfaces/protocol.schema.json), paired [fixtures](interfaces/fixtures), and the role validators. This guide explains ownership and integration. Run `python agent/interfaces/validate_contracts.py` before changing a shared interface.

## Envelope

Every request contains:

```json
{
  "schema_version": "1.0",
  "request_id": "workflow-assigned-task",
  "room_id": "authenticated-room",
  "operation": "negotiate.detect",
  "input_revision": 12,
  "payload": {"contract_version": "2.0"}
}
```

This illustrates the envelope, not a complete operation payload. Use a fixture for runnable input. Requests also carry the operation's discussion round, room context and authorized data. Integrated Interview uses its dedicated `2.1` payload; do not upgrade unrelated roles automatically.

A response echoes the five envelope fields and adds `status`, `data`, `warnings` and `error`. Valid statuses are `ok`, Interview's `needs_input`, Evaluator's `partial`, and `error`. Successful data includes its contract version and has `error:null`. Errors have empty data and `{code,message,retryable}`. Undeclared fields, mismatched references and invalid enums are rejected.

The model supplies only operation data/status/warnings where the runtime expects them. The harness creates the trusted envelope. An `ok` result does not mean a person approved it.

## Shared context and identity

`Ref` is `{id,version}` with a positive version. Workflow creates authoritative IDs, versions, source IDs and timestamps. Local question, item, slot, dependency and evidence keys are not authorization.

`RoomContext` includes member IDs, hackathon context, deadline and constraints. `SharedContext` includes approved profiles, per-round source references and a source catalogue with the actual approved text. A source identifies its kind, original reference, member, discussion round and text. Source references must resolve within the current authorized request.

The complete shared history excludes raw private interviews and private message IDs. Memory search cannot restore a removed or unauthorized source. An agent reads only the projection passed to it.

## Operations

| Operation | Main input | Main output |
| --- | --- | --- |
| interview.turn | member_id, mode, private messages, current_profile, shared_context, followup_context, interview_turn, limits | Questions or a request to summarize, with ready_to_summarize and stop_reason |
| interview.summarize | Interview context plus stop_reason | Editable profile_draft with items and unknowns |
| negotiate.detect | Shared context | One difference or clarification |
| idea.generate | Shared context, confirmed convergence_decision, candidate_slots | Exactly one draft per supplied slot |
| idea.revise | Current candidate, evaluation and agreed human revision | A revised draft linked to the supplied version |
| evaluator.evaluate | Candidate, shared sources, evidence and tool budget; adapter also receives time/resources | Evaluation with findings, evidence, risks, unknowns and recommendations |

### Interview

Modes are `initial`, `followup` and `reopened`. Initial context is private to the member. Follow-up uses the actual difference and human answers; reopened mode additionally includes the reviewed candidate, its evaluation and the request for further discussion. See the dedicated [follow-up contract](interview/followup-integration.md).

A question has a local key, text, displayable purpose and authorized source references. Respect `max_questions` and `remaining_question_batches`; a zero budget stops questioning. Never fabricate a member answer.

Summary items preserve category, text, evidence basis, confidence and private evidence references. They remain private until the member edits and approves them. Workflow then creates the shared projection and removes private message references.

### Negotiation

A difference contains kind, category, question, answer type, options, affected members, significance and source IDs. Binary questions have exactly two options; open questions have none. A clarification is an unknown to resolve, not invented conflict. Both require human answers. There is no generated vote, action or convergence decision in this result.

### Ideas

Generation requires a workflow-confirmed convergence decision at any discussion round, including round 1, after the required human answers. Candidate slots are unique and number one to five. Return every slot exactly once; do not create candidate IDs or versions.

Drafts describe title, users, problem, solution, MVP scope, exclusions, contributions, tradeoffs, dependencies, unknowns and discussion source trace. Revisions must honor the current candidate/report references and actual shared instructions. Workflow assigns the new version and requests a new evaluation.

### Evaluation

The adapter converts the shared contract to the evaluator's native request, including an explicit project time limit and approved team resources. The evaluator maintains a real retrieval ledger and checks submitted source IDs against it. Public-web evidence that cannot be represented in the narrower shared schema is retained in `evaluation_details`; the projection is then labelled partial.

`complete` describes report completeness, not a claim that the project is feasible. Native test verdicts are `pass`, `fail` and `insufficient_evidence`. No result can generate a user's final acceptance.

## Human events

Browser events use contract 2.0: `interview.answer`, `profile.approve`, `difference.answer`, `convergence.vote`, `candidate.review`. They require a current object reference and the appropriate per-identity event revision. See [workflow HTTP API](../workflow/README.md#human-events) and [complete examples](interfaces/fixtures/human-events.json).

## Implementation boundary

Use role definitions with explicit input/output validation and injected read-only tools. Module paths are trusted deployment configuration, never client input. Integrated services preserve role-specific normalization and validation. Do not replace them with legacy Pi sample definitions.

Invalid input/output, provider failure and timeout are distinct from a rejected project. Retry remains bounded and cannot repeat a human decision or commit a stale model result. See [Pi Base](pi-base/README.md) for correction behavior and [workflow recovery](../workflow/README.md#persistence-and-recovery) for transaction/lease rules.
