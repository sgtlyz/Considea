# Idea contracts

`schema.mjs` exports `schemaFor(version)`. The default is the strict **2.0** Idea
request/response contract, derived directly from `agent/interfaces/protocol.schema.json`.
Calling `schemaFor('2.1')` creates a separate Idea-only extension. It never mutates
the canonical schema or silently upgrades Interview, Negotiator, or Evaluator.

## 2.1 research extension

Both input operations require `contract_version: "2.1"` and add:

- `search_policy`: `{enabled, max_queries, max_results_per_query, required}`.
  Limits are 0–8 queries and 1–5 results per query. Disabled search or a zero
  query budget forbids network searches. Provided evidence may still be used.
- `provided_evidence`: a required array of at most 40 evidence entries obtained
  and checked by the trusted Workflow. Empty arrays are valid. Model-supplied
  evidence is never trusted.

Every CandidateDraft, including the current candidate passed to `idea.revise`,
adds the required `inspiration_refs` array. Each entry contains exactly
`{evidence_key, borrowed_mechanism, adaptation, known_difference}`.
The array may be empty. A referenced key must resolve to the service's actual
provided/tool evidence ledger before a result is released.

Evidence has exactly `{evidence_key,url,title,accessed_at,source_kind,excerpt,
content_level,limitation}`. `source_kind` is `reddit`, `devpost`, or `web`.
`content_level` is always `snippet`: neither a provider excerpt nor a search
result establishes that a complete page was read or a project implementation
was verified. Timestamps are recorded by the caller/tool, never the model.
URLs are HTTPS only (at most 2,048 characters), without credentials, IP literals,
local or reserved hostnames. Reddit/Devpost evidence must use the corresponding
domain. Titles are capped at 200 characters and excerpts at 1,200 characters.

Model data retains the canonical generate/revise shapes, plus the draft field
above. It **does not contain evidence, search_log, or research**. After model
output validation, the service attaches top-level
`research: {evidence: [...], search_log: [...]}` to every 2.1 final response,
including errors. A search log entry is exactly `{query,source_kind,result_status,
evidence_keys}`. Result status is `results`, `no_results`, `failed`, `disabled`,
or `budget_exceeded`. The service owns this sidecar and checks every inspiration
key against its ledger. The sidecar is forbidden on 2.0 responses.

## Validation and authority boundary

The definition enforces JSON Schema before cross-reference checks: source
uniqueness; exact current profile/source text and identity; ordered, typed
history; current round ≥4 and matching convergence references; exact output
slots; member-backed contributions; and exact candidate/evaluation/review
versions for revisions. Agent inferences cannot be recast as member inputs.
Revisions require real `minor_revision` reviews with nonblank instructions and
must explain their changes. The canonical revision fixture does not include
its newest review in the history directory, so that Source entry is optional;
when supplied it must match the review.

These checks establish internal consistency, **not human authorization**.
Workflow must authenticate room access, project only currently authorized text,
resolve conflicting reviews, verify stored convergence events, and reject stale
revisions before calling the agent. Historical source text may remain in the
directory without a current profile row; Source alone does not establish that
a historical profile item was a member statement rather than an inference.
Such historical items may be cited as discussion context or `agent_synthesis`,
but never as `member_input`. Profile-based member attribution requires a current
profile item whose basis explicitly equals `member_statement`. Member-backed
`difference_answer` sources are also accepted. Supporting historical profile
attribution would require an explicit Workflow-provided basis contract extension.
An authorized converge event permits generation but never proves unanimity.
After revision the Workflow must store a new version and repeat evaluation and
human review. mem0 retrieval is supplementary and must be reauthorized against
the authoritative store before its source text reaches the model.

`validateResponse(request, response)` applies the complete response schema,
exact task headers, draft checks, and research-ledger reference consistency to
both fresh results and cached replays. It accepts only a valid request. It also
checks that supplied evidence is unchanged, tool evidence is listed in a
corresponding result log, result counts/query attempts respect policy, and every
inspiration reference resolves. These checks still cannot prove that a forged
ledger came from a real network tool; only service-owned ledger construction and
authenticated storage provide that boundary.

The 2.1 extension needs an explicit adapter before handing a researched
CandidateDraft to a role that only accepts the strict shared 2.0 schema. Do not
pass the extra field to an unchanged evaluator and assume compatibility.
