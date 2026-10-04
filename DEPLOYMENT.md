# Deploy Considea: Vercel frontend + Render backend

`master` contains the four integrated agents and the deployment configuration.
The default deployment is explicitly labelled **mock**. Enable real model calls
with the environment settings below after verifying the disposable demo.

```text
Browser -> Vercel static workbench
              /api/* -> Render Python workflow + workers
                          -> SQLite: private history and authoritative state
                          -> Interview / Negotiator / Idea / Evaluator
                          -> optional SpacetimeDB: shared board and Idea jobs
```

Vercel forwards same-origin `/api` requests to Render, retaining the prefix.
Authenticated API responses are not cached. Only `workflow/web` is published as
static content; API keys, private database files and agent source stay on the server.

## Production branch

Use `master` from https://github.com/sgtlyz/Considea (formerly MHacks) on both hosts.
If an existing deployment still tracks `deploy/vercel-render`, change its branch
in the Render and Vercel dashboards to `master`, then redeploy. A Git merge alone
does not change an existing host's dashboard settings. This repository update
does not create or verify a cloud deployment.

## Render backend

Create a Blueprint from `master` using root `render.yaml`, or update the existing
service. The Blueprint retains one free Docker service:

| Setting | Value |
| --- | --- |
| Dockerfile / context | `./Dockerfile` / repository root |
| Start | `python -m deploy.start` (Docker CMD) |
| Listen address | `0.0.0.0:$PORT` |
| Health check | `/api/health` |
| `CONCLAVE_MODE` | `mock` (initial demo) |
| `CONCLAVE_MODEL` | `offline` (when using integrated mode) |
| `CONCLAVE_EVALUATOR` | `agent` |
| `CONCLAVE_WORKERS` | `2` |
| `CONCLAVE_DB` | `/data/conclave.sqlite3` |

The Linux image includes Python 3.12, Node 24, locked dependencies for all four
agents, and compiled SpacetimeDB client bindings. It runs as an unprivileged user.
The Python Negotiator uses rules and does not call an LLM.

**Free-tier SQLite is disposable:** restart, redeploy and spin-down lose local
state. Wake the service and create a new demo room before inviting teammates.
For durable rooms, choose a paid instance and persistent disk mounted at `/data`
after agreeing the cost. Keep one service instance. SpacetimeDB does not replace
SQLite's private interviews, credentials, event history or recovery records.
This Blueprint neither purchases a disk nor adds a paid service.

### Real agents

Set these variables **on Render only**, then restart and create a fresh room:

| Variable | Real model configuration |
| --- | --- |
| `CONCLAVE_MODE` | `integrated` |
| `CONCLAVE_MODEL` | `live` |
| `CONCLAVE_EVALUATOR` | `agent` |
| `PI_PROVIDER` | `deepseek` |
| `DEEPSEEK_MODEL` | `deepseek-flash` |
| `DEEPSEEK_API_KEY` | Private provider key |
| `EVALUATOR_PROVIDER` | `deepseek` |
| `EVALUATOR_RETRIEVAL` | `api` |
| `TAVILY_API_KEY` | Private search/read key |

`EVALUATOR_MODEL` can override the model used for evaluation. Other providers
use the configuration documented in [integration instructions](workflow/INTEGRATION.md).
Do not put credentials in Vercel, source files or `render.yaml`. Existing process
variables take precedence over a root `.env` during local development; `.env`
and local databases are excluded from both Git and the Docker image.

For an offline smoke check, use `CONCLAVE_MODE=integrated` and
`CONCLAVE_MODEL=offline`. The actual agent code runs with clearly marked model
and retrieval fixtures. `/api/health` reports `integrated-offline`; live reports
`integrated`. RoomView also reports `agent_runtime.model` as `fixture` or `live`.
Providing an API key alone does not activate live calls. The legacy `pi` mode
requires separate compatible role definitions; use `integrated` for this team.

Create live rooms separately from mock/offline rooms. Specify the project time
limit when creating a room and enable public web search if desired. If the time
limit is missing, the workflow waits for administrator input before evaluation.
An evaluation may return insufficient evidence; a working deployment is not
proof that a candidate is novel or feasible.

When managing the service through a Blueprint, keep the Blueprint values and
intended dashboard settings aligned before a later Blueprint sync. The checked-in
Blueprint intentionally retains mock/offline defaults.

### Optional SpacetimeDB

Publish the repository's module to the intended reachable SpacetimeDB server
using CLI/SDK **2.10.2** and the [preparation instructions](workflow/INTEGRATION.md#接-spacetimedb).
Use that server's URL in the private configuration; a laptop's `127.0.0.1` URL
cannot reach the database from Render. Module publishing remains an explicit
step, not an action performed during an application build or start.

Provide the private JSON configuration on Render at a writable server-side path,
for example `/data/spacetime.json`, and set
`CONCLAVE_SPACETIME_CONFIG=/data/spacetime.json`. It contains `uri`, `database`,
`owner_token`, and the generated `workflow_token` / `worker_token`. First connection
writes the latter two identities back, so the file and its directory must be
writable by the container user. If using a Render secret file, provision a private
writable copy before startup; do not point at a read-only secret file for initial
identity creation. Never commit this file or expose it to the browser.

The prepared private file must survive restarts on persistent storage, or be
securely provisioned again. SQLite needs its own persistence even when
SpacetimeDB is enabled. Without this setting, integrated agents use SQLite and
HTTP polling; the frontend does not need a direct database credential.

## Vercel frontend

Import the repository with the repository root as Root Directory, framework
**Other**, Node 24, and production branch **master**.

Set `BACKEND_URL` in each intended environment (Production and Preview) to the
actual Render HTTPS **origin**, without `/api`, credentials, path or query.
Example format: `https://your-assigned-service.onrender.com`.

`vercel.ts` configures `node deploy/build-frontend.mjs`, the `dist` output,
API rewrites, and cache policy. Missing or malformed `BACKEND_URL` fails the
configuration. Redeploy Vercel after changing the variable because routes are
built at deploy time. The build copies only `workflow/web` to `dist`.

## Verification

The `Deployment checks` workflow builds the actual Linux image on pushes to
`master`, `feat/integration-spacetimedb` and `deploy/vercel-render`, and relevant
pull requests. It checks workflow recovery and human gates, cloud HTTP startup
and persistence, all four agents, SpacetimeDB reducer contracts, client imports,
Vercel routing and the static build. CI uses offline fixtures and no model keys;
a running SpacetimeDB server and real APIs are separate integration checks.

After installing the dependencies in [integration instructions](workflow/INTEGRATION.md):

```sh
python -m unittest discover -s workflow/tests -v
python -m unittest discover -s deploy/tests -p 'test_*.py' -v
python agent/interfaces/validate_contracts.py
node --test deploy/tests/*.test.mjs
node deploy/build-frontend.mjs
docker build -t considea-deploy .
docker run --rm -p 10000:10000 considea-deploy
```

The restart test preserves a room only when using the same database file; it
does not make Render's ephemeral filesystem persistent.

After deployment, check the actual Vercel URL:

1. `/api/health` reaches Render and reports the expected mode.
2. Create a disposable room, save its administrator token privately and join as
   two members in independent browser sessions.
3. Confirm interviews respond and each member sees only their own private data.
4. Complete four discussion rounds, answer differences, then explicitly converge.
5. Generate and evaluate a candidate; request a small revision, reevaluate, and
   accept the current version from both members.
6. With SpacetimeDB enabled, confirm the shared board synchronizes. Record the
   public demo URLs only after this check passes.

## References

- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render free-tier storage limits](https://render.com/docs/free)
- [Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts)
- [Vercel external rewrites](https://vercel.com/docs/routing/rewrites)
