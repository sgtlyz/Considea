# Idea Generator

`idea.generate` turns the complete authorized team discussion into candidate ideas. `idea.revise` changes one exact candidate version using its evaluation and authenticated minor-revision reviews. Both run through the shared Pi core and return structured proposals to Workflow.

Implemented here: strict input/output validation, prompts, per-run Reddit/Devpost/web tools, optional Mem0 recall, server-side memory synchronization helpers, a SpacetimeDB persistence module, offline demonstrations, and a bounded DeepSeek runtime. Database deployment, authentication UI, human vote aggregation, and the Evaluator implementation remain application integration work. No live-provider result is claimed by the offline demo.

## Run locally

Node >=22.19 and pnpm 11.19 are required. From the repository root:

```powershell
pnpm --dir agent/pi-base install --frozen-lockfile
pnpm --dir agent/idea install --frozen-lockfile
pnpm --dir agent/idea test
pnpm --dir agent/idea demo
pnpm --dir agent/idea exec node demo.mjs --revise
```

The demos use the actual Pi tool loop with a deterministic fake model and fake search provider. Every output is labeled `OFFLINE MOCK`. They require no keys and do not make network calls. `--no-research` exercises the original 2.0 contract. The demo returns three structurally different fixture candidates; it does not measure real-model creativity or usefulness.

Complete paired research examples: [generate](examples/idea-generate-research.json) and [revise](examples/idea-revise-research.json). These contain fabricated human events and must not be treated as real approval records.

## Backend integration

```js
import { runIdea } from './agent/idea/service.mjs';
import { createDeepSeekRuntime } from './agent/idea/runtime.mjs';
import { createTavilyProvider } from './agent/idea/search.mjs';
import { createMem0Client } from './agent/idea/memory.mjs';

// Build request from the server's authenticated, currently authorized snapshot.
// Never forward arbitrary browser-supplied profiles, approvals, evidence, or room IDs.
const response = await runIdea({
  request,
  runtime: createDeepSeekRuntime({ maxModelRequests: 6, maxTokens: 4096 }),
  searchProvider: createTavilyProvider({ apiKey: process.env.TAVILY_API_KEY }),
  memoryClient: createMem0Client({ apiKey: process.env.MEM0_API_KEY }),
  signal: requestAbortSignal,
});
// Atomically check authorization/input/candidate versions before publishing.
// Then Evaluator -> Human Review; this response never means acceptance.
```

Search and memory clients are optional. Construction makes no provider call. Supply a fresh model runtime per task so its HTTP budget belongs to that task. `runIdeaFromStore` handles the read/run/commit sequence with a store adapter; a durable task claim must precede model execution, and commit must recheck revision/hash. See [memory-spacetime.md](memory-spacetime.md) and [Spacetime module](spacetime/README.md).

The trusted Workflow supplies:

- Room members, competition context, deadlines, and constraints with their acceptance/verification status.
- Current approved profiles and the **complete still-authorized discussion history**, including actual source text and stable references. Hard constraints and human decisions are always included; Mem0 never replaces them.
- For generation: round >=4, the matching authenticated human convergence event, and 1–5 reserved unique candidate slots.
- For revision: one current candidate, its matching evaluation, and matching minor-revision reviews. Conflicting instructions must be resolved by Workflow before calling the Agent.

The original [shared contract](../contracts.md) and [schema](../interfaces/protocol.schema.json) are unchanged. Use the new default-export `definition.mjs` or `runIdea`, not legacy `pi-base/roles.mjs`, which does not register Idea.

## Versioned research extension

Contract `2.0` accepts the existing canonical fixtures and has no research fields. Idea-specific contract `2.1` is explicitly negotiated by the caller and defined in [contracts](contracts/README.md). It is not a repository-wide version migration.

For 2.1, add these required fields to the payload:

```json
{
  "contract_version": "2.1",
  "search_policy": {
    "enabled": true,
    "max_queries": 4,
    "max_results_per_query": 3,
    "required": false
  },
  "provided_evidence": []
}
```

Every 2.1 draft also has `inspiration_refs`, with `{evidence_key, borrowed_mechanism, adaptation, known_difference}` entries. The **service**, not the model, attaches final response `research: {evidence, search_log}`. Evidence records contain actual returned URL, title, retrieval time, bounded excerpt, source kind, and `content_level: "snippet"`. Candidate discussion refs and external inspiration refs are separate.

`required: true` requires every returned candidate to cite at least one supplied or retrieved evidence record. It does not prove that an excerpt supports the candidate's claim; that needs Evaluator/human review. Optional research failure leaves a warning and permits proposals grounded in the shared discussion. Missing or fabricated evidence references reject the output. Search ledgers distinguish failure, no results, disabled access, and exhausted budget.

2.1 candidates cannot be sent unchanged to the strict 2.0 Evaluator because of `inspiration_refs`. After validating and persisting the full response, use `projectForV2Evaluator({candidateRef,draft,research})` from `handoff.mjs`: it returns the canonical `candidate` and a separate version-bound `research` package for Workflow/UI retention. It never converts Reddit anecdotes into official documentation or verified tests. A versioned evaluator research extension is needed before claiming that the existing Evaluator consumes the new evidence package.

## Tools and memory

`search_reddit`, `search_devpost`, and `web_search` accept only a short generic query. The first two enforce their domains. All tools share the same attempted-query cap, including failures, and use fixed Tavily endpoints with no automatic retries or arbitrary URL fetch. Snippets are bounded and treated as untrusted data; this version does not fetch full pages. Member ID/email checks reduce accidental query leakage but are not complete personal-data detection. Production query policy must reflect what the team authorizes sending to the search provider.

`recall_shared_memory` is exposed only when configured, with at most two recalls per run. Mem0 results can only select sources already present in the current authorized directory; source ID, object version, room, visibility, and content digest must match. The model receives current source text from the request, never a Mem0-generated replacement. A memory outage leaves the complete discussion available.

Mem0 synchronization is a trusted background operation, not an Agent tool. It stores approved shared source text verbatim (`infer:false`) in a stable room namespace. Persist receipts and unknown outcomes before retrying; an interrupted remote write may already have succeeded. Revocation is enforced immediately by fresh authorization snapshots and revision checks; external deletion is a separate data-lifecycle task. This module does not automatically erase historical records in Mem0.

## Live execution

Copy `.env.example` to a local `.env` or configure the server environment. Set an explicit supported `DEEPSEEK_MODEL`; the CLI does not select one for you. Real keys stay server-side. Search needs `TAVILY_API_KEY`; optional memory needs `MEM0_API_KEY`.

```powershell
node --env-file=agent/idea/.env agent/idea/cli.mjs --live --input authorized-request.json --max-model-requests 6 --max-output-tokens 4096
```

This command can incur provider charges. It is a stateless developer invocation with explicitly authorized input, not a public server endpoint. The CLI default is offline. No live call was made during implementation. Request/token/search caps bound work, not a precise USD charge; SDK zero-price fields are placeholders and must not be reported as actual cost.

Defaults: six model turns, ten tool calls, 90 seconds overall, 100 KB request-size admission limit, at most eight searches allowed by the schema and two memory recalls. The byte cap is an application admission limit, not a token count. Oversized history is rejected rather than silently truncated. The application must choose a model/context budget compatible with its full snapshot.

## Validation boundary

Offline tests cover contract compatibility, human gate consistency, source/room/version isolation, exact candidate slots, revision references, genuine tool ledgers, quota/timeout handling, provider transport shape, cancellation, and memory reauthorization. Spacetime type checking validates SDK compatibility, and its reducer tests exercise real exported functions with a mocked host/database context. Deployment and live concurrency behavior require a real database. Structural and mock-provider tests cannot prove model quality, external search coverage, provider account access, or authenticated end-to-end product behavior.

Official references: [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search), [Mem0 search](https://docs.mem0.ai/api-reference/memory/search-memories), [Mem0 add](https://docs.mem0.ai/api-reference/memory/add-memories), [SpacetimeDB permissions](https://spacetimedb.com/docs/tables/access-permissions/), [DeepSeek JSON output](https://api-docs.deepseek.com/guides/json_mode/).


## 集成分支的输出 harness

输出格式从现有协议 Schema 生成，并按当前请求约束候选槽位、base_candidate_ref 和可用共享 source_id，并与校验器共用 member_input 来源白名单（当前成员陈述或真实分歧回答）；最终仍由原有结构、来源归属和证据校验决定能否发布。

仅 contract 2.0 且未注入 memoryClient 的无工具模式，在 JSON/输出协议失败时最多让模型纠正一次。纠正与初次调用共用原超时（默认 90 秒）和总模型轮次限制；不是重跑整个 Idea 任务。provider 错误不自动重试，二次失败不发布部分结果。contract 2.1 研究扩展与 Mem0 工具模式不启用纠正，避免重放工具或检索。

跨调用重试、SpacetimeDB 缓存/租约和提交版本校验仍按原流程执行。测试及真实闭环状态见 [整合验收记录](../../workflow/INTEGRATION.md)。
