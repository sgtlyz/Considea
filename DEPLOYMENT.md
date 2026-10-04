# Deploy Considea: Vercel frontend + Render backend

This setup publishes the existing `workflow/web` workbench and Python workflow.
It does not implement or merge the team's unfinished business agents.
The initial backend runs in **mock mode**, which the workbench labels explicitly.

```text
Browser -> Vercel static workbench
              /api/* -> Render Python HTTP server + worker threads
                          -> SQLite
                          -> Node / Pi agents when configured
```

The frontend uses same-origin `/api` URLs. Vercel forwards those requests to
Render, retaining the `/api` prefix. Authenticated API responses are not cached.
No model credentials are copied into the static frontend.

## 1. Publish the deployment branch

Repository: https://github.com/sgtlyz/Considea (formerly MHacks).
Use branch `deploy/vercel-render` for this isolated deployment. Select this branch
in both hosting providers; `master` does not contain these deployment files yet.

Do not merge another contributor's unfinished agent branches merely to deploy.
When the team integrates them into `master`, bring those changes into this branch,
run the tests below, and push to redeploy.

## 2. Render backend

Create a Blueprint from this repository and select `deploy/vercel-render`.
The root `render.yaml` creates one free Docker web service with:

| Setting | Value |
| --- | --- |
| Dockerfile / context | `./Dockerfile` / repository root |
| Start | `python -m deploy.start` (Docker CMD) |
| Listen address | `0.0.0.0:$PORT` |
| Health check | `/api/health` |
| `CONCLAVE_MODE` | `mock` |
| `CONCLAVE_WORKERS` | `2` |
| `CONCLAVE_DB` | `/data/conclave.sqlite3` |

The container includes Python 3.12, Node 22, and the locked Pi dependencies.
Wait for the service to become live and copy its actual HTTPS URL from Render.
Check `/api/health`; it must return `status: ok` and the expected `agent_mode`.

**Free-tier data is disposable.** Render free web services lose local SQLite data
on restart, redeploy, and spin-down. Do not promise durable rooms on this tier.
An idle service also has a cold-start delay. Recreate a disposable demonstration
room after waking the backend, before inviting teammates or recording the demo.

For durable SQLite, choose a paid instance only after agreeing the cost, add a
persistent disk mounted at `/data`, and retain `CONCLAVE_DB=/data/conclave.sqlite3`.
Keep one service instance. Alternatively, implement and test a separate persistent
database adapter; this branch does not pretend SQLite is already PostgreSQL.

## 3. Vercel frontend

Import the same GitHub repository, with repository root as Root Directory.
Select **Other** as the framework and use Node 22 or 24. Set the production branch
to `deploy/vercel-render` if using the stable production URL for this demo.

Add `BACKEND_URL` to the required Vercel deployment environments (Production and
Preview), using the Render service's actual HTTPS **origin**, without `/api`.
For example, `https://your-assigned-service.onrender.com` is a format example,
not an existing deployment URL.

`vercel.ts` configures the build (`node deploy/build-frontend.mjs`), output (`dist`),
API rewrites, and cache policy. Missing or malformed `BACKEND_URL` fails the
configuration early instead of publishing an apparently functional disconnected UI.
Redeploy Vercel after changing `BACKEND_URL` because the routes are built at deploy time.

Only `workflow/web` is copied into `dist`. Provider API keys, the SQLite database,
Python source, and agent code are not frontend build artifacts.

## 4. End-to-end check

1. Open the actual Vercel deployment URL in a browser.
2. Visit its `/api/health` and confirm it reaches the Render backend.
3. Create a disposable room and save its administrator token privately.
4. Join as two separate members in independent tabs, using their own invitations.
5. Confirm the interview worker responds and the UI clearly reports mock mode.
6. Verify a member cannot read another member's private responses.
7. Save the final frontend/backend URLs in the hackathon submission only after
   this check passes. Hosting success alone does not meet the Fetch.ai ACP/ASI requirements.

## Enable real agents after team integration

Merge and verify the actual role modules (`agent/interview/definition.mjs`,
`agent/negotiate/definition.mjs`, `agent/idea/definition.mjs`, and
`agent/evaluator/definition.mjs`), or configure the corresponding
`CONCLAVE_<ROLE>_MODULE` variables on Render. Set `PI_PROVIDER`, `PI_MODEL`, and the
chosen provider's credential **on Render only**, then change `CONCLAVE_MODE` to `pi`.
Missing module files cause startup to fail clearly. Their presence alone does not
prove model quality, protocol compatibility, or external-tool reliability.

Create new pi-mode rooms after switching; mock rooms are not converted to real ones.

## Local verification

The `Deployment checks` GitHub Actions workflow builds the actual Linux container
and runs the workflow, startup, contract, Node runtime, and frontend checks on
pushes to `deploy/vercel-render`. No deployment credentials or model keys are needed.

```sh
python -m pip install -r workflow/requirements.txt
python -m unittest discover -s workflow/tests -v
python -m unittest discover -s deploy/tests -p 'test_*.py' -v
python agent/interfaces/validate_contracts.py
node --test deploy/tests/*.test.mjs
node deploy/build-frontend.mjs
pnpm --dir agent/pi-base install --frozen-lockfile
pnpm --dir agent/pi-base test
```

When a Docker engine is running:

```sh
docker build -t considea-deploy .
docker run --rm -p 10000:10000 considea-deploy
```

The Python deployment test checks a real HTTP process and verifies that restarting
against the **same local database** preserves a room. This does not make Render's
free ephemeral filesystem persistent.

## References

- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render free-tier limits and ephemeral storage](https://render.com/docs/free)
- [Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts)
- [Vercel external rewrites](https://vercel.com/docs/routing/rewrites)
