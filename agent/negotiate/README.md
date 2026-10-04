# Negotiator

The integrated live workflow calls `service.mjs` through the existing Node/Pi bridge and the room-selected DeepSeek or OpenAI runtime. Each operation gets an isolated model instance and only authorized shared profiles, history and sources. The Negotiator selects one consequential semantic difference or clarification; it cannot generate candidates, answer for members or decide convergence.

The prompt distinguishes compatible preferences, genuine team differences, missing information and a single member's contradictory statements. A personal clarification targets only its respondent and the workflow enforces its privacy. The model uses the shared discussion's language and must respect earlier human answers and framing corrections.

## Validation and limits

The frozen v2.0 schema validates input and output. Additional checks reject unknown members, unresolved or misattributed profile sources, duplicate options and blank text. A team difference requires cited human evidence from at least two affected members; agent inferences and system questions alone do not qualify. These checks establish structure and provenance, not semantic truth: people still confirm the framing and answer the question.

The Pi harness allows at most two model turns (one original response and one correction) within a single 60-second deadline. The operation has no tools. Missing credentials, provider failures and invalid output remain explicit errors; there is no automatic rule fallback. Workflow-level transient retries remain bounded and retain their existing task accounting.

The existing Python `handle_request` / `python -m agent.negotiate` entry point is a deterministic legacy baseline. Integrated offline mode uses it only to construct a labelled model fixture and sends that fixture through the same Node/Pi service. It is not the live implementation.

## Run and verify

Install `agent/negotiate` and the other packages in [the integration guide](../../workflow/INTEGRATION.md). Existing provider configuration is reused; no separate Negotiator key is needed. DeepSeek uses `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL`; OpenAI uses `OPENAI_API_KEY` / `OPENAI_MODEL` (or `PI_MODEL`) with `PI_PROVIDER=openai`. Room-supplied keys remain isolated per call.

```sh
pnpm --dir agent/negotiate install --frozen-lockfile
pnpm --dir agent/negotiate test
python -m unittest agent.negotiate.test_negotiator workflow.tests.test_negotiator_integration -v
```

The opt-in live smoke test uses three synthetic cases: incompatible target users, compatible conditional preferences and one person's contradictory participation conditions. With the selected provider and its credentials already in the process environment, run:

```sh
CONCLAVE_RUN_LIVE=1 node agent/negotiate/live-smoke.mjs --live
```

It makes at most six model requests (two per case), does not touch deployed rooms, and stops on a failed assertion. This is a small integration check, not a statistical evaluation of negotiation quality.

On October 4, 2026, the smoke test passed all three cases with `deepseek-flash`, one provider request per case (three total). The compatible-preference case returned a clarification rather than a fabricated split; the personal-contradiction case targeted only the affected member. These observations do not establish population-level accuracy or eliminate the need for human framing corrections.
