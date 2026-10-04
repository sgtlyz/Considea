# Interview Agent

`service.mjs` exposes `runInterview` for initial interviews, focused follow-ups and private summary drafts. The integrated workflow uses the current v2.1 contract; `legacy-definition.mjs`, the standalone CLI and local interview workflow remain separate developer examples.

## Run

From the repository root:

```sh
pnpm --dir agent/pi-base install --frozen-lockfile
pnpm --dir agent/interview install --frozen-lockfile
pnpm --dir agent/interview test
pnpm --dir agent/interview demo
```

For the standalone live CLI, configure `agent/interview/.env` from its example and run `node --env-file=agent/interview/.env agent/interview/cli.mjs --live`. This uses paid API calls. `/finish` requests a summary, `/quit` exits, and `SHARE` confirms the edited export. This CLI does not join a team room; use the [integrated workspace](../../workflow/INTEGRATION.md) for team testing.

## Team interface

`interview.turn` receives one member's authorized private messages, current approved profile, shared context, mode, follow-up context and question limits. It returns questions or readiness to summarize. `interview.summarize` returns a private draft with items and unknowns. See [shared contracts](../contracts.md) and [follow-up details](followup-integration.md).

The workflow owns identity, discussion rounds, summary approval and persistence. An agent's readiness to summarize is not a team convergence decision. A private inference must not become a shared fact before the member approves it.

## Output harness

The service derives per-request output instructions from the schema. Missing trusted identity/version fields and local sequence keys may be filled from validated input. Explicitly wrong identities, duplicate keys, unsupported sources or invented facts are not overwritten to force success.

JSON or protocol failure allows at most one model correction within the original 60-second deadline. Invalid input and provider errors do not take that correction path. Remaining question budget zero is handled in code. Inputs are copied before asynchronous execution; runtime injection supplies model/transport, not a replacement role or unlimited repair policy.

The shared Pi harness only performs narrow syntactic repairs before full validation. A second invalid output fails the task; no partial profile is published. Real acceptance evidence belongs in [DEV-ACCEPTANCE.md](../../docs/DEV-ACCEPTANCE.md), separate from package fixtures.

## Other adapters

The [Agentverse adapter](agentverse/README.md) supports a standalone personal session, persistent profile updates and reviewed summaries. It is not the team workflow's identity or database layer. Its deployment and historical live-test record are documented separately.

[DEVELOPMENT.md](DEVELOPMENT.md) describes the package workflow. Earlier alignment proposals have been replaced by current contracts; the history remains in Git.
