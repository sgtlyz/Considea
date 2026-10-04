# Deploy Considea

The release under review is on `dev`. New work is not merged into `master` or promoted to the production website automatically.

```text
Browser -> Vercel static workspace -> /api/* -> Render workflow + workers
                                             -> PostgreSQL authoritative state
                                             -> Interview / Negotiator / Idea / Evaluator
                                             -> optional SpacetimeDB shared projection
```

The Render service also serves the same workspace directly. This gives the dev release a public test URL even when Vercel preview protection requires a team login.

## Current environments

| Environment | Frontend | Backend | Data / model mode |
| --- | --- | --- | --- |
| Existing production, master | https://considea.vercel.app | https://considea-api.onrender.com | Disposable SQLite, labelled mock |
| Development, dev | https://considea-git-dev-yingzeng.vercel.app (Vercel login required) | https://considea-dev-api.onrender.com (public workspace) | PostgreSQL, live DeepSeek and Tavily |

The free development PostgreSQL instance expires **2026-11-03**. It is persistent across web-service restarts, but is a temporary database, not permanent hosting. Render's free tier does not include database backups. Keep accepted-brief exports and arrange a database migration or paid plan before expiry. See [Render free-service limits](https://render.com/docs/free).

## Backend configuration

Build the root `Dockerfile` with repository root as context. It runs Python 3.12 and Node 24, installs locked agent dependencies, and starts `python -m deploy.start` as an unprivileged user. Listen on `0.0.0.0:$PORT`; health check is `/api/health`.

| Variable | Development value |
| --- | --- |
| CONCLAVE_MODE / CONCLAVE_MODEL / CONCLAVE_EVALUATOR | integrated / live / agent |
| DATABASE_URL | Render PostgreSQL internal connection string |
| CONCLAVE_WORKERS | 2 |
| PI_PROVIDER / EVALUATOR_PROVIDER | deepseek / deepseek |
| DEEPSEEK_MODEL | deepseek-flash |
| DEEPSEEK_API_KEY / TAVILY_API_KEY | Existing private team keys |
| EVALUATOR_RETRIEVAL | api |
| CONCLAVE_SECRET_KEY | Persistent Fernet encryption key |
| CONCLAVE_DEMO_ACCESS_CODE | Private team/judge demo access code |
| CONCLAVE_SHARED_DAILY_CALLS | 120 |
| CONCLAVE_ROOM_CALL_LIMIT | 80 |
| CONCLAVE_TRUST_PROXY | 1 only behind the trusted deployment proxy |

Keep secrets in the hosting environment. `.env`, workflow data and private connection files are excluded from Git and Docker. Preserve the encryption key independently from database backups. Losing it means stored user keys must be entered again.

`DATABASE_URL` takes precedence over `CONCLAVE_DB`. Without it, SQLite is stored at the configured local path. SQLite on a free ephemeral web-service filesystem does not survive service replacement or spin-down. Optional SpacetimeDB does not replace the private workflow database.

The dev web service is free and has autodeploy disabled for controlled acceptance. Deploy it explicitly after merging a verified feature into `dev`. Production retains its own branch and autodeploy settings. Do not trigger a second manual deployment immediately after a push to an autodeploy-enabled service.

The root `render.yaml` remains the original mock production blueprint. Do not sync it over the live dev service. `render.dev.yaml` describes the separate dev setup; reusing an existing database avoids creating a duplicate instance.

## Frontend configuration

Vercel publishes only `workflow/web`, copied into `dist`. `BACKEND_URL` must be an HTTPS origin with no path, query or credentials. `vercel.ts` forwards `/api/:path*` to the backend while retaining `/api`, and disables authenticated response caching.

The preview variable scoped to branch `dev` points at the dev backend. The production variable still points at the production backend. Redeploy after changing this value because it is used at build time. Vercel preview protection may require login; the public Render dev URL is available for invited judges.

The static frontend never contains model keys or database credentials. Invite secrets use the URL fragment and are removed from the address bar when read. Recovery and room-key actions still require the proper room credentials.

## Acceptance

Check `/api/capabilities` for `live:true`, `storage:"postgres"` and supported encrypted key entry. `/api/health` being healthy is not enough to prove real calls.

Use two independent browser sessions. Complete four rounds of private answers, approved shared summaries and difference answers. Confirm generation waits for both convergence votes. Review actual retrieval evidence, request a revision, verify a new report, and accept the same version from both members. Export the result.

Restart or redeploy the dev service, then restore the same identities and compare the accepted result. Also check invalid credentials, used invitations, old tokens after recovery, key removal and spending limits. Use synthetic data for recorded demos. [DEV-ACCEPTANCE.md](docs/DEV-ACCEPTANCE.md) records what was actually verified.

## Backup and operational limits

An accepted brief is a portable product output, not a complete database backup. For full recovery, use a PostgreSQL logical dump to a private location and keep the encryption key separately. Restrict external database access to a specific administrative address only for the export, or run the export over a trusted connection. Never commit a dump: it includes private interviews and credentials.

Free web instances may sleep. Start the demo shortly before presenting, and keep the recorded replay available. Shared API limits are measured in tasks, not dollars; provider-side spending controls remain useful. Live evaluation establishes documented evidence, not a working implementation of a generated project.
