# Considea Agentverse gateway

Four ACP identities expose the **existing integrated Workflow** through ASI:One.
Interview handles member answers and profile approval; Negotiate handles difference
answers and convergence votes; Idea and Evaluator expose candidate review and results.
The Workflow backend runs the actual agent implementations from master. This does
not deploy four independent hosted Python agents into Agentverse's code editor.

## Existing Render deployment (recommended)

The root Docker image includes the ACP dependencies. `workflow.server` enables
the gateway only when `CONSIDEA_AGENTVERSE_SEEDS_JSON` is configured. Its value is
the private `seeds` object from `.agentverse-local/config.json`, not the whole file.
Reuse the existing Interview seed; never generate replacement identities on restart.
Keep these seeds in Render's private environment configuration, never in Git.

- `GET /agentverse/status`: four addresses and gateway status, without model calls.
- `POST /agentverse/{interview,negotiate,idea,evaluator}/chat`: signed ACP endpoints.
- `CONSIDEA_AGENTVERSE_ALLOW_CREATE=0`: default; keep creation disabled during initial
  registration and transport verification. Set to `1` only for authorized funded use.
- Reuse the existing `DATABASE_URL` and `CONCLAVE_SECRET_KEY`. Additive `av_*` tables
  retain sessions, message reservations and one-use transfers. Private records are
  encrypted with the existing Fernet key. PostgreSQL state survives Render restarts.

No second public listener or local tunnel is needed. The gateway calls the existing
Workflow in-process with each member's own credential and the existing access-code,
rate-limit and task-budget checks. New ACP-created rooms disable automatic task retries.
Uncertain outgoing actions are not automatically repeated.

Register each role with `--origin https://considea-dev-api.onrender.com` after its
health endpoint and signed transport have been tested. The registration script
defaults to `--path-prefix /agentverse`.

Rollback: remove `CONSIDEA_AGENTVERSE_SEEDS_JSON` and redeploy, or redeploy the previous
known-good commit. Existing Workflow routes and tables remain unchanged. Do not drop
the new tables or rotate seeds/encryption keys; preserve state for recovery.

## Standalone development

Install the pinned Python dependencies in `../interview/agentverse/requirements.txt`.
From the repository root:

```sh
python -m agent.agentverse.init_config --interview-config PATH_TO_EXISTING_PRIVATE_CONFIG
python -m agent.agentverse.app --config .agentverse-local/config.json
cloudflared tunnel --url http://127.0.0.1:8012
python -m agent.agentverse.register --config .agentverse-local/config.json --key-file PRIVATE_KEY_FILE --origin https://ACTUAL_HOST --path-prefix "" --role negotiate
```

Repeat registration explicitly for `idea`, `evaluator`, and `interview`; never retry
an uncertain registration without inspecting the dashboard. Reusing Interview's
seed updates its existing profile and endpoint. Back up the private configuration.
A temporary tunnel requires this computer and both processes to remain running.
Its URL changes on restart and requires an explicit registration update.

Only the fixed configured HTTPS backend receives requests. Public message text
cannot override the backend URL, signed sender, or conversation. Invitations are
single-use, credentials stay in the private SQLite store, and sessions are isolated
by agent role, verified sender and conversation. Protect that local state as a
credential file; it also contains private replies. Run one gateway process only.
No provider keys are loaded by this gateway.

## Chat commands

- `/help`: usage without model calls.
- `/create JSON`: create a room with `room_context`, optional `config`, and a team
  `access_code`. Disabled until the operator sets `allow_create: true`. Do not put
  provider keys in ASI messages. The existing backend still enforces access and limits.
- `/join ROOM_ID INVITATION`: join one member's existing room.
- `/status`: read the authorized workflow view, including current references and
  event revisions. Private interview content is omitted outside Interview.
- `/event JSON`: submit an explicit human event under the existing v2 contract.
  The room, event type and role must match; stale revisions are never refreshed
  automatically. The signed chat message determines an idempotent event ID.
- `/handoff ROLE`: issue a one-use transfer code for another role, valid 10 minutes.
- `/resume CODE`: resume that same member's room in the target role conversation.
- `/export`: return the unanimously accepted final output, if it exists.

Use the exact events documented in `workflow/README.md`. Natural-language requests
receive guidance; this first adapter requires explicit structured event commands.
It does not infer profile approval or votes from free text. A general natural-language
ASI workflow and full competition submission remain separate acceptance work.

## Verification

```sh
python -m unittest agent.agentverse.test_gateway agent.agentverse.test_hosted -v
```

These tests cover signature checks on all identities, ACK/session preservation,
private-session isolation, one-use role transfers, duplicate delivery, uncertain
network outcomes, and explicit revision/role checks. They use simulated HTTP
responses, not live model or search calls. Registration, ASI message delivery,
search discovery and paid end-to-end acceptance must be reported separately.
