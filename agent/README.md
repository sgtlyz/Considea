# Agent development

The workflow calls six operations across four teammate implementations. It owns authentication, human events, persistence and transitions; agents return structured suggestions from the supplied context.

| Role | Operations | Entry point |
| --- | --- | --- |
| Interview | interview.turn, interview.summarize | interview/service.mjs |
| Negotiator | negotiate.detect | negotiate/service.mjs (LLM, validated shared evidence) |
| Idea Generator | idea.generate, idea.revise | idea/service.mjs |
| Evaluator | evaluator.evaluate | evaluator/workflow.mjs adapter |

All four are integrated. Start with [contracts](contracts.md), [schema and fixtures](interfaces/README.md), and [integration instructions](../workflow/INTEGRATION.md). The shared envelope stays at `schema_version:"1.0"`; integrated Interview uses its dedicated 2.1 payload, while other team operations use shared 2.0. Idea's optional research 2.1 contract is a separate extension.

To work in parallel, change your role's implementation behind its contract and provide valid request/response examples plus tests. Coordinate schema, enum or field changes with the workflow owner. Do not access the full room database, call another business agent, wait for a browser action or create an approval inside an agent.

[Pi Base](pi-base/README.md) provides the model/tool loop and output harness. Its legacy role examples are not the four-role application. Each integrated call gets explicit authorized context; there is no implicit cross-room conversation memory.
