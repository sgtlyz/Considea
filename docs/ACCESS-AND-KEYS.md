# Room access and API keys

A room has one administrator and one private identity per invited participant. The welcome screen is not account authentication. Bearer tokens authorize room actions; an administrator cannot read a participant's interview or vote for them.

## Creation and recovery

`GET /api/capabilities` describes live/offline mode, storage, and supported key entry. `POST /api/rooms` accepts the existing room context/config plus either `access_code` for the shared demo or `credentials: {deepseek_api_key, tavily_api_key}` for the creator's keys. Live shared access is closed when `CONCLAVE_DEMO_ACCESS_CODE` is absent. Keys are checked for shape here, not verified with the provider.

Creation returns an administrator token, administrator recovery code, and one-use invitations. Joining returns a member token and private recovery code. Save recovery codes privately. Never post invitation URLs or recovery cards publicly.

| POST route under `/api/rooms/{room_id}` | Caller | Body and result |
| --- | --- | --- |
| `/join` | Invitation holder | `{invitation}` -> token, recovery code, member ID |
| `/recover` | Recovery code holder | `{role, member_id, recovery_code}` -> new token and new recovery code; previous credentials are revoked |
| `/recovery-code` | Authenticated identity | `{}` -> replacement recovery code; previous recovery code is revoked |
| `/invitation` | Administrator | `{member_id}` -> new invitation, only if the participant has never joined |
| `/presence` | Member | `{available: false}` marks away; `true` resumes availability |
| `/keys` | Administrator | `{credentials: {...}}` replaces keys; `{credentials: null}` deletes them |

Leaving a tab does not remove a participant's required approval. An away participant can resume. If the team changes permanently, end the room and create a room for the new team. There is no silent exclusion or administrator impersonation.

## Secret handling

`CONCLAVE_SECRET_KEY` is a persistent Fernet key on the server. Room keys are encrypted at rest and bound to a room ID. They do not enter workflow snapshots, task payloads, shared projections, or browser responses. Each model call receives a separate environment object; no process-wide key replacement occurs. Back up the encryption key separately from the database. Losing it requires users to enter their keys again.

Removing room keys pauses further work and never falls back to shared keys. A call already in progress may finish. DeepSeek is currently the supported user-supplied model provider. Tavily is required when web research is enabled. The room administrator pays for everyone in that room using the configured keys.

## Limits

Shared live access requires the demo code. Persistent limits apply globally (40 new rooms/day, 1200 writes/minute), per client (6 rooms/hour, 180 writes/minute, 12 recovery attempts/hour), per room (default 80 agent tasks), and to the shared-key daily task allowance (default 120). Failed or retried claims count conservatively. Provider calls inside a task have separate bounded retries; task counts are not a dollar spending cap. Configure a provider-side spending limit as well.

Limits survive app restarts. Daily limits reset at UTC midnight. Per-client limits rely on a trusted deployment proxy; the global bounds apply even if client headers are forged. `CONCLAVE_TRUST_PROXY=1` trusts only the final forwarded address. A room cannot raise its call allowance above the deployment cap through the public API.

Tests: `python -m unittest workflow.tests.test_security -v`.
