# Evaluator Agent

The evaluator researches similar projects and technical feasibility for an already developed candidate. It returns findings, actual sources, unknowns and proposed changes. It does not generate candidates, advance discussion rounds or approve a project for people.

## Run

From the repository root:

```sh
pnpm --dir agent/pi-base install --frozen-lockfile
pnpm --dir agent/evaluator install --frozen-lockfile
pnpm --dir agent/evaluator test
pnpm --dir agent/evaluator demo
```

The demo uses the real tool runner with simulated model and retrieval responses. `fixture:true` is not live research. `pnpm --dir agent/evaluator demo --json` prints the full fixture result.

Use [workflow integration](../../workflow/INTEGRATION.md) for the team product. `workflow.mjs` converts authorized shared v2.0 requests into the native evaluator contract and returns both the compatible projection and full `evaluation_details`.

## Judgments

Each novelty and feasibility test returns `pass`, `fail` or `insufficient_evidence`. `passed` is derived from both tests passing. Successful execution is independent of whether the idea passes.

Novelty compares target users, core problem and mechanism. Existing related products do not automatically disqualify a candidate, but a renamed clone or model swap is not a demonstrated distinction. The evaluator researches GitHub repositories and Devpost hackathon projects, not every project on either platform. It reads specific project pages; topics, profiles and gallery pages are not competitor evidence. Missing coverage cannot support a novelty pass.

Feasibility checks the smallest demo, necessary APIs/data/hardware, team resources and the explicit project time limit. It is a document/resource assessment, not execution of the proposed prototype. Unknown critical dependencies prevent a confident pass; a documented blocker yields a failure or required scope change.

Searches with no results do not prove global originality. Official documentation supports a documented capability, not a tested integration.

## Tool and source boundary

The model submits via `submit_report`; the server checks candidate identity and source IDs against a request-scoped retrieval ledger. The server constructs the envelope, source records and derived verdicts. Invalid submissions share one bounded correction opportunity; repeated invalid output returns `INVALID_OUTPUT`, not a failed novelty judgment.

DeepSeek and OpenAI use tool calls for retrieval and final submission, with actual retrieval required on the first turn when research is enabled. Other configured models also have a validated text-JSON compatibility path. Only returned/read evidence can support claims. Non-official sources remain `public_web`; they are not upgraded into official or tested evidence.

Individual investigations separate capability outcome (`available`, `blocked`, `unknown`) from evidence basis. An official source can document that a capability is unavailable; source authority alone does not imply a pass.

## Configuration

| Variable | Purpose |
| --- | --- |
| EVALUATOR_PROVIDER | deepseek, openai or gemini; defaults to PI_PROVIDER, then deepseek |
| EVALUATOR_MODEL | Explicit override; OpenAI otherwise uses OPENAI_MODEL / PI_MODEL; integrated DeepSeek uses DEEPSEEK_MODEL |
| DEEPSEEK_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY | Selected server-side provider key |
| EVALUATOR_RETRIEVAL | api for Tavily HTTP, or the supported standalone CLI adapter |
| TAVILY_API_KEY | Required by the HTTP retrieval adapter |
| EVALUATOR_OFFICIAL_DOMAINS | Comma-separated verified official documentation domains |

Requests carry finite search/read, per-call and total execution budgets. The workflow's two-search allowance covers the two minimum novelty scopes; it may leave technical evidence incomplete. Disabled search makes no retrieval calls and cannot establish novelty through new evidence.

The HTTP adapter uses fixed Tavily search/extract endpoints and server-side credentials. The CLI adapter runs without a shell, with UTF-8 and cancellation support. See the implementation tests for timeout and failure behavior.

## Standalone transport

`cli.mjs` reads one compact JSON request per line and returns one JSON response per line. Add `--fixture` for an offline request. Do not send a pretty-printed multiline document as JSONL.

Python callers can use `run_evaluator(request, fixture=True)` from `python_bridge.py` for offline testing or omit `fixture` for authorized live calls. The bridge returns structured process/timeout failures and does not retry automatically. Run blocking work in an external worker or `asyncio.to_thread`.

The native contract and examples belong to this package. The shared workflow adapter is the only supported team handoff; do not forward a native report into the shared schema without conversion.

[LIVE_TEST_REPORT.md](LIVE_TEST_REPORT.md) preserves the teammate's earlier standalone test record. The current cloud release's real HTTP retrieval and full-team acceptance are recorded separately in [DEV-ACCEPTANCE.md](../../docs/DEV-ACCEPTANCE.md).
