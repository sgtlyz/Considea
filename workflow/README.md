# Workflow and HTTP API

`engine.py` owns the state machine. `store.py` provides SQLite and PostgreSQL transactions. `server.py` exposes HTTP and starts workers; `integration.py` connects teammate agents. `web/` contains the shared browser interface.

## Start

```sh
python -m pip install -r workflow/requirements.txt
python -m workflow
```

Open `http://127.0.0.1:8765`. This is mock mode. See [INTEGRATION.md](INTEGRATION.md) to install and run the actual agent code, offline or live.

| Argument | Default | Meaning |
| --- | --- | --- |
| --host / --port | 127.0.0.1 / 8765 | HTTP listen address |
| --db | workflow/data/conclave.sqlite3 | Local database; DATABASE_URL selects PostgreSQL instead |
| --mode | mock | mock, legacy pi, or integrated teammate services |
| --model | offline | Integrated offline fixtures or live model calls |
| --evaluator | agent | Actual evaluator; stub and blocked are debugging modes |
| --spacetime-config | unset | Private writable optional SpacetimeDB configuration |
| --workers | 4 | Concurrent workers, 1–16 |

The repository-root `.env` is loaded automatically. Existing environment variables win. Private data is ignored by Git. A room retains its runtime mode and is handled only by matching workers.

## Room rules

Every discussion round includes private interviews, member-approved summaries and human answers to a difference or clarification. Rounds 1–3 return to Interview; round 4 or later opens an explicit choice. All members must converge to generate; any diverge starts another round.

Every generated candidate is evaluated before review. All members must choose the same action for the same candidate/report versions. Small revisions require identical trimmed instructions, produce a new version and clear old approvals. More discussion preserves earlier candidates and returns to Interview. Only unanimous acceptance creates `final_output`.

Away members remain required. No admin impersonation, majority fallback or automatic approval is implemented.

A `clarification` with one `affected_member_ids` entry is private to that member. They see the question and answer form; other members and the administrator receive a generic waiting card, without the question, cited profile items or answer. The same filtering applies to source history and SpacetimeDB snapshots. `RoomView.difference.visibility` is `private`; its ref and round remain available for the later team vote. Team differences and multi-member clarifications remain shared.

Only the respondent's interview Agent receives the personal clarification and answer. Other interview Agents continue from their own messages/current profile and authorized shared context (`mode: initial`, no followup payload under contract 2.1). This does not reset the discussion round or bypass any human gate. New summaries are shared only after approval; historical personal clarification sources stay private. Generation and evaluation receive public sources only. Stored state remains intact; read projections and pending task dispatch enforce the policy for existing rooms too. This cannot revoke information already seen before the policy was applied.


## Creation options

| Field | Engine default | Accepted values |
| --- | --- | --- |
| question_batches_per_round | 1 | 1–7 |
| max_questions | 3 | 1–3 |
| candidate_count | 3 | 1–5 |
| max_agent_calls | 200 | 1–10000; public live API caps at deployment limit, default 80 |
| max_task_retries | 2 | 0–3 automatic retries within an attempt cycle |
| search_enabled | false | Boolean; the web form enables it by default |
| max_search_queries | 0 | Engine 0–50; public live API caps at 2 |
| project_time_limit | null | `{kind:"none"}`, `{kind:"duration",hours:24}`, or `{kind:"deadline",deadline_at:"..."}` |
| decision_policy | unanimous | Only supported policy |

A missing time limit holds evaluation for administrator input; it does not mean unlimited time. Time constraints cannot silently change after evaluation.

## HTTP

Send JSON with `Content-Type: application/json`; maximum body size is 1 MiB. Protected routes require `Authorization: Bearer <token>`. The server derives identity from that token; a caller cannot supply a trusted actor.

| Method and path | Input | Result |
| --- | --- | --- |
| GET /api/health | None | Health and runtime mode |
| GET /api/capabilities | None | Live mode, store, encrypted-key support and demo availability |
| POST /api/rooms | `{room_context,config?,access_code?,credentials?}` | Room ID, admin token/recovery code, one-use invitations, mode |
| POST /api/rooms/{id}/join | `{invitation}` | Member token, member ID and recovery code |
| GET /api/rooms/{id} | None | Authorized RoomView |
| POST /api/rooms/{id}/events | ClientEvent v2.0 | Accepted event or rejected business result |
| POST /api/rooms/{id}/tasks/{task}/retry | `{}` | Requeued task if permitted |
| POST /api/rooms/{id}/project-time-limit | `{time_limit}`; administrator | Initial time configuration, idempotent for the same value |
| POST /api/rooms/{id}/budget | `{max_agent_calls}`; administrator | Higher allowance within the deployment cap |
| POST /api/rooms/{id}/stop | `{}`; administrator | Ended room, pending work stopped |
| GET /api/rooms/{id}/updates | None; authenticated | Optional SpacetimeDB-backed SSE progress |

Additional `/recover`, `/recovery-code`, `/invitation`, `/presence` and `/keys` endpoints are specified in [ACCESS-AND-KEYS.md](../docs/ACCESS-AND-KEYS.md).

`room_context` contains `member_ids`, `hackathon_context`, `deadline_at` and `constraints`; see the [schema](../agent/interfaces/protocol.schema.json). At most 12 members are supported. Live shared-key creation requires the access code; alternatively supply DeepSeek and optional Tavily room keys. Research-enabled rooms require Tavily.

Non-event failures return `{error:{code,message}}` with a 4xx/5xx status. Provider errors and private task bodies are not returned to the browser.

## RoomView

| Fields | Meaning |
| --- | --- |
| room_id, revision, discussion_round, phase, mode | Room snapshot metadata |
| room_context, config, agent_runtime | Team context and actual runtime |
| actor | Current role and member ID |
| members | Public progress, joined/away status and approved round |
| private | Current member's history, questions and draft; null for admin |
| event_revisions | Revisions for interview, difference, convergence and per-candidate review |
| shared_context | Approved profiles, discussion history and resolvable source catalogue |
| difference, answers, votes, convergence_decision | Shared question, human responses and decisions |
| candidates, evaluations, evaluation_details, reviews | Current candidates and source-backed/native reports |
| candidate_history | Earlier candidates, reports and reviews |
| tasks | Permitted task status and safe error codes; no raw request or response |
| access | Funding/key status and permitted controls; never raw keys |
| calls_started, paused_reason | Attempts and budget/credential/daily-limit pauses |
| selected_candidate_ref, final_output | Null until the team accepts a candidate |

Objects use `{id,version}` references. Match both fields; titles and list positions are not identities. Private interview tasks expose status only to their member and the administrator. The administrator cannot read private content.

## Human events

All events have `contract_version:"2.0"`, a fresh `event_id`, `room_id`, `expected_revision`, `type`, and the operation payload. Complete examples are in [human-events.json](../agent/interfaces/fixtures/human-events.json).

| Type | Payload | expected_revision |
| --- | --- | --- |
| interview.answer | session_ref, question_batch_ref, answers | event_revisions.interview |
| profile.approve | draft_ref, edited items, unknowns | event_revisions.interview |
| difference.answer | difference_ref, selected_option_key or null, text, disagrees_with_framing | event_revisions.difference |
| convergence.vote | difference_ref, discussion_round, decision, reason | event_revisions.convergence |
| candidate.review | candidate_ref, evaluation_ref, decision, instructions | event_revisions.review[candidate_id] |

Do not use the top-level snapshot revision for events. Revision checks isolate independent member actions. Repeating the same event ID, actor and body returns the original result; changing the body or actor returns a conflict. A corrected rejected event needs a new ID. Stale input requires refresh and explicit resubmission, not blind replay.

## Persistence and recovery

A transaction commits the state transition and any newly queued tasks together. Workers claim tasks with renewable leases, invoke agents outside the transaction, and commit only if the lease and source references still match. Stale or late results cannot revive a stopped room. Failed outputs do not partially advance the workflow.

The store retains task attempts and an outbox for optional shared sync. PostgreSQL serializes workflow transactions with an advisory lock; SQLite uses its transaction lock. The same database must be reused on restart. Database backups also require the stable encryption key to recover encrypted room keys.

Run `python -m unittest discover -s workflow/tests -v`. CI additionally tests PostgreSQL and the complete browser path. [INTERFACE.md](INTERFACE.md) describes the UI tests; [DEV-ACCEPTANCE.md](../docs/DEV-ACCEPTANCE.md) separates live evidence from offline checks.
