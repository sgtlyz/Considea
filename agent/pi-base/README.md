# Pi execution harness

Pi Base runs a single authorized agent operation with an explicit model, role definition, validators and optional tools. It does not implement room identity, durable memory or the four-role product workflow.

## Run the offline examples

```sh
pnpm --dir agent/pi-base install --frozen-lockfile
pnpm --dir agent/pi-base test
pnpm --dir agent/pi-base demo
```

Use Node 24 for the repository integration. The demo runs a real Pi loop with a faux provider and marked fixture responses; it does not prove live model behavior.

## Integration

Use the current [agent contracts](../contracts.md) and each role's validated service entry point. `runAgent({request,definition,model,streamFn})` runs a role directly; `cli.mjs` and `python_bridge.py` provide JSONL/process transport. Module paths are trusted configuration, never user input.

A role specifies operations, input validation, output validation, output instructions and an optional tool factory bound to the authorized request. Tools implement Pi's AgentTool interface and return structured content. Tool factories should not start network work. Tools must honor cancellation and must not write authoritative room decisions.

`roles.mjs` and `example-role.mjs` retain legacy examples; they are not the integrated four-agent application. The generic CLI does not load a root `.env` automatically. The workflow application does.

## Limits and failure

Each call creates a new Pi instance with supplied context. The default harness has finite model turns, tool executions and a total deadline. It copies envelope identity from the validated request. Public progress reports event types and request IDs, not private conversation text, tool bodies or internal reasoning.

`maxOutputRepairs` defaults to zero. The integrated Interview and no-tool Idea services opt into one correction with a shared deadline and turn budget. This corrects invalid JSON/output protocol only; it does not retry the entire business operation or provider errors. Tool-enabled operations cannot use this repair path, avoiding side-effect replay.

Before asking the model to correct, the harness permits narrow local syntax repairs: complete missing closing containers at the end, or attach a standalone trailing string warnings array to a prematurely closed top-level object. It does not create missing fields, change facts, guess sources or repair unterminated strings. Every repaired output is fully revalidated. A second invalid response fails without publishing a partial result.

Operations can supply `outputSchema(payload)` and safe `outputIssues` codes/paths. These constrain the prompt and local validator; they are not a claim of provider-side strict schema decoding. Detailed diagnostics require an explicit protected callback. Raw provider failures and keys are not exposed through public progress.

Identity, authorization, durable deduplication, current-version checks and transaction commits remain Workflow responsibilities. Task/turn/token limits are not a dollar budget. A non-cooperative custom tool may outlive a cooperative timeout; use a process boundary when hard isolation is required.
