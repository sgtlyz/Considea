# Agent integration

The integrated path uses all four teammate implementations: Interview, the Python rule-based Negotiator, Idea Generator and Evaluator. Mem0 is disabled. Model calls and web retrieval can run live or through explicit offline fixtures.

## Install and run

From the repository root, with Python 3.10+, Node 24 and pnpm 11.19.0:

```sh
python -m pip install -r workflow/requirements.txt
pnpm --dir agent/pi-base install --frozen-lockfile
pnpm --dir agent/interview install --frozen-lockfile
pnpm --dir agent/idea install --frozen-lockfile
pnpm --dir agent/evaluator install --frozen-lockfile
pnpm --dir agent/idea/spacetime install --frozen-lockfile
pnpm --dir workflow/node install --frozen-lockfile
pnpm --dir workflow/node build
python -m workflow --mode integrated --model offline --evaluator agent
```

Offline mode exercises real services and validators with simulated model/retrieval responses. It does not call paid APIs. Negotiation uses the Python rules in both modes.

For live mode, create a root `.env` from `.env.example`, choose `PI_PROVIDER=deepseek` or `PI_PROVIDER=openai`, and configure the selected model key/model plus Tavily. DeepSeek uses `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL`; OpenAI uses `OPENAI_API_KEY` / `OPENAI_MODEL` (or `PI_MODEL`). Evaluator follows `PI_PROVIDER` unless `EVALUATOR_PROVIDER` is set; `EVALUATOR_MODEL` is an optional model override. When switching an existing `.env`, clear or update old evaluator overrides, including a DeepSeek-specific `EVALUATOR_BASE_URL`. Set a demo access code for shared-key access. Generate `CONCLAVE_SECRET_KEY` once using the command in the template; retain it across deployments. Run:

```sh
python -m workflow --mode integrated --model live --evaluator agent
```

The root `.env` loader supports UTF-8 BOM, comments and quotes. It does not expand `${...}`, search parent folders or load agent subfolder files. Process variables win. Restart after changing environment settings. A key alone never switches offline mode to live.

Use fresh rooms for each runtime mode. Create the room with a project time limit (`none`, `duration` with hours, or `deadline` with a timestamp). Omitting it pauses evaluation until the administrator supplies it. A `room_context.deadline_at` can provide the deadline; conflicting values are rejected.

## Boundaries

| Operation | Implementation | Integration contract |
| --- | --- | --- |
| interview.turn / interview.summarize | `agent/interview/service.mjs` | Interview 2.1 with full follow-up context |
| negotiate.detect | `agent/negotiate` Python package | Shared v2.0 |
| idea.generate / idea.revise | `agent/idea/service.mjs` | Shared v2.0; optional Spacetime job adapter |
| evaluator.evaluate | `agent/evaluator/workflow.mjs` | Shared v2.0 adapter to the evaluator's native contract |

The Python workflow owns authentication, state transitions and task leases. Node receives an authorized request and returns structured data. User-supplied keys travel through the private per-call transport, not the stored request or shared context. Each call constructs its own model environment.

Interview and the no-tool Idea path have strict output validation and at most one model correction within their original deadline. The harness permits only narrow syntactic repairs; it does not invent missing facts, sources or approval. Invalid output remains a failed task. The UI retains answers and exposes retry controls.

Evaluator uses real Pi tool calls with a source ledger, finite searches/reads and validated report submission. The integrated HTTP retrieval adapter uses Tavily. Reports may honestly return `partial` or `insufficient_evidence`. This is distinct from a failed API call.

## Storage

Set `DATABASE_URL` for PostgreSQL; omit it for local SQLite via `--db`. Both persist room snapshots, credential hashes, human events, pending tasks, lease attempts, encrypted room keys, limits and the shared-sync outbox. Task results commit only if their lease and input references remain current.

PostgreSQL transactions use a shared advisory lock to serialize state changes across workers. Model calls run outside transactions. This implementation favors correctness for small teams; it is not designed for high-volume multi-tenant traffic.

### Optional SpacetimeDB

Use matching CLI and SDK version 2.10.2. For a local instance:

```sh
spacetime start --listen-addr 127.0.0.1:3000
python -m workflow.prepare_spacetime --server http://127.0.0.1:3000 --database considea-dev
python -m workflow --mode integrated --model offline --spacetime-config workflow/data/spacetime.json
```

The private configuration contains server/database identifiers and owner/workflow/worker tokens. Never commit it. The first connection writes generated identities back, so the path must be writable and persistent. Publish the module explicitly; ordinary app startup does not publish it.

SpacetimeDB stores approved shared projections and Idea jobs. Private interviews, identity, human events and recovery still belong to the workflow database. Without SpacetimeDB, the same workflow uses HTTP polling. For cloud deployment, use a reachable database URL; Render cannot reach a laptop's localhost. The current dev cloud uses PostgreSQL and does not claim a deployed SpacetimeDB instance.

## Verification

```sh
python -m unittest discover -s workflow/tests -v
python agent/interfaces/validate_contracts.py
pnpm --dir agent/interview test
pnpm --dir agent/idea test
pnpm --dir agent/evaluator test
python -m unittest agent.negotiate.test_negotiator -v
```

PostgreSQL tests require `CONCLAVE_TEST_POSTGRES_URL` and create an isolated test schema. Spacetime tests require their explicit local configuration. Missing optional services are reported as skipped, not passed. [Deployment checks](../.github/workflows/deployment-checks.yml) runs the image, PostgreSQL, agent and browser suites with offline fixtures.

`workflow/node/live-dev-smoke.mjs` is an opt-in live acceptance script. It uses a dedicated development deployment and synthetic participants, records a browser video, and saves private artifacts under ignored `workflow/data/dev-live/`. It never runs automatically in CI. The release evidence and limits are recorded in [DEV-ACCEPTANCE.md](../docs/DEV-ACCEPTANCE.md).
