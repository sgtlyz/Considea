# Development release acceptance

Verified on October 4, 2026 before promotion. At that checkpoint, all work was integrated into `dev` and `master` remained at `4f1b067053d1202f265a4e5a5aa3bce813d960a4`. The accepted release was subsequently merged into `master` as `f9c2750` and its existing live backend was promoted to serve the production website. See [current deployment](../DEPLOYMENT.md).

- [Direct live workspace](https://considea-dev-api.onrender.com)
- [Public recorded walkthrough](https://considea-dev-api.onrender.com/demo.html)
- [83-second video](../workflow/web/demo.mp4)

## Delivered scope

| Requested item | Result and evidence |
| --- | --- |
| 4. Database deployment | Render PostgreSQL 17 is the development primary store. The live API reports `postgres`. The existing room, identities, round, candidates, evaluations, task states and counters survived application replacement at commit `9410b81`. |
| 5. Usable interface | Guided creation, personal invitation links, next-action text, round progress, readable evidence and brief export. Browser tests cover two isolated participants, a 375px viewport, drafts, refresh and recovery. |
| 6. English repository | Current product, setup, workflow, API and agent documentation is in English. Superseded design documents point to the current contracts. |
| 7. Bring your own keys | Room-scoped encrypted DeepSeek/Tavily credentials with replacement/removal. Real browser tests created separate invalid-key and valid-key rooms: invalid credentials failed without falling back to the server key, while valid credentials completed both interview tasks. Keys were cleared from inputs and absent from browser storage and room responses. |
| 8. Real testing | The public development server completed real DeepSeek and Tavily calls with two isolated browser identities, four human-gated rounds, three candidates, a requested revision, new evaluation, fresh unanimous acceptance, export and reload. The two participants were scripted test fixtures. |
| 9. Identity and recovery | One-use invitations, private recovery cards and token rotation. Tests reject old credentials and keep each interview private. Marking a participant away never removes their required vote; a permanently changed team needs a new room. |
| 10. Public limits | Database-backed per-client and global limits, a shared daily task allowance, room caps and bounded searches. Tests cover concurrent claims, restart persistence, forged-header global bounds and room budget escalation. |
| 11. Judge/demo readiness | An account-free, key-free replay contains saved shared output from the completed real run. It makes no API calls. A downloadable video works independently of model availability. Actual errors and evidence limitations are disclosed. |

## Real-run record

The accepted direction was **One-Board Study Checklist with Honest Alternatives Note**, candidate version 2. The room completed at discussion round 4 after both participants accepted the same revised version. It consumed 39 workflow task claims, including non-model work and failed/retried tasks; this is not a count of billable requests or a dollar estimate.

Three evaluator attempts were rejected for invalid output. A diagnostic reproduced fields being nested under `data.tests` instead of the report root. Commit `45f2dfc` added precise validation feedback and candidate-version-specific prompt examples; validation was not relaxed. After deploying that fix, an explicit retry succeeded and the team completed the room. The run is a recovery test, not evidence of a zero-failure model integration.

The final report still returns **insufficient evidence** for novelty and feasibility. Human acceptance does not override those findings. The public replay preserves the report and its source limitations.

A separate real-key isolation test succeeded on October 4: two tasks in the invalid-key room failed with provider errors; both tasks in the valid-key room completed. Those test rooms were stopped afterward.

## Verification and reproducibility

- Workflow/security tests: `python -m unittest discover -s workflow/tests -v`.
- PostgreSQL CI tests: `python -m unittest workflow.tests.test_postgres -v` with `CONCLAVE_TEST_POSTGRES_URL` pointing to an isolated test database.
- Full browser acceptance and replay: `node workflow/node/interface-smoke.mjs` with Playwright installed. This uses mock responses and makes no live calls.
- All evaluator JavaScript tests passed after the feedback fix (91 tests), including the malformed nesting and current-version regressions.
- [CI for the real-tested code](https://github.com/sgtlyz/Considea/actions/runs/37189452521) passed the deployment image, agent packages, browser and PostgreSQL jobs. Subsequent commits run the same checks, including video/replay verification.
- Real full-flow test: `workflow/node/live-dev-smoke.mjs`. It requires `CONCLAVE_RUN_LIVE=1`, `CONCLAVE_TEST_URL`, Chrome, and a private `workflow/data/dev-infra.json` containing `demo_access_code`. It resumes the private saved session by default. `--retry-failed` requests a bounded explicit retry.
- Real own-key test: `node --env-file=.env workflow/node/live-keys-smoke.mjs` with the same opt-in and test URL. It requires existing DeepSeek and Tavily keys and creates/stops isolated rooms.

`PLAYWRIGHT_MODULE` can point to an installed Playwright package. Real tests are opt-in and consume provider credit. Raw recordings, logs, credentials, checkpoints, downloaded briefs and persistence comparisons stay in ignored `workflow/data/`. Public files contain only synthetic demonstration content and approved shared results; no invitations, credentials or API keys are included.

## Operational boundaries

The free Render development server can sleep. Its free PostgreSQL instance expires on **November 3, 2026** and is not a permanent production database or a backed-up service. Export briefs and migrate data before then. The encryption key must be preserved separately when moving the database.

SpacetimeDB cloud deployment is **not enabled** in this preview. PostgreSQL is the source of truth; the optional SpacetimeDB integration and its submission remain separate work. The room access system is not a complete account service. User-supplied model keys currently support DeepSeek, with Tavily for research.

After promotion, the production website uses the existing live backend and database. Vercel development previews use the separate mock backend and remain protected by the project's Vercel login settings. Use the production URL for team or judge access. The evidence above records the original pre-promotion acceptance.
