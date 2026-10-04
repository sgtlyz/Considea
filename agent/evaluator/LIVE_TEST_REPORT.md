# Evaluator real API test report

**Policy update after this snapshot:** evaluations now require separate GitHub repository and Devpost hackathon-project searches, with domain-filtered calls and server-owned novelty_coverage. The real API runs recorded below predate that requirement and do not validate it. The new policy is covered by offline regression tests; its real API behavior has not been rerun in this update.

The policy-update regression run passed **81 evaluator + 10 Pi Base + 5 Python checks = 96**. Coverage includes separate platform calls, HTTP/CLI filter forwarding, off-scope and directory rejection, zero/one-search budgets, native submission correction, concurrency/cancellation, and backward-compatible historical reports. Both evaluator SKILL.md files are now English.

**Validation snapshot completed October 4, 2026, 12:31 a.m. America/New_York:** all six expected behaviors have passing observations across the latest suite and a focused retest. **The latest complete suite passed 5/6; its investigation failed. After the investigation-only fix, the focused investigation passed. This is not a single 6/6 suite run.**

Real DeepSeek and authenticated Tavily CLI calls exercised the Node/Pi evaluator, web search and source-body reads. The samples use artificial team premises and ideas; service responses are real. A harness pass means expected behavior was observed. It does not mean an idea was accepted: all three sample evaluations returned passed=false.

## Environment and scope

| Item | Recorded configuration |
| --- | --- |
| Host | Windows PowerShell, Node v24.19.0, Python 3.13 |
| Model | DeepSeek deepseek-flash through pinned Pi packages |
| Model endpoint | https://api.deepseek.com/beta for strict tool calls; standard /models for availability |
| Retrieval | Authenticated Tavily CLI, TVLY_PYTHON=python process-local compatibility entry point |
| Versions | Request envelope 1.0; report 1.2; sample candidate version 2 |
| Project time | Explicit time_limit.kind=none for evaluations; deliberately omitted for preflight; unnecessary for topic investigation |
| Per-scenario execution budget | 3 searches, 4 reads, 180 seconds total, 30 seconds per retrieval call, 12 model turns |

Ordinary request defaults are 2 searches, 3 reads, 60 seconds total and 10 seconds per retrieval call. The test uses higher supported limits. These execution limits do not impose a deadline on the proposed project.

Generated report fields are English; original excerpts and supplied names are retained. Credentials and hidden reasoning are excluded from the artifacts. No commit, push, merge or competition submission belongs to this procedure.

## Test procedure

1. Run local contract, runner, provider, retrieval, workflow, CLI and Python checks without contacting real services. Final regression result: **65 evaluator + 10 Pi Base + 5 Python checks = 80 passed**, plus a separate successful offline fixture bridge invocation.
2. Submit an evaluation without a project time answer. Expect needs_input, no verdict, and zero external calls.
3. List DeepSeek models, request a small JSON marker, search through Tavily, and read a returned MDN body. Require the intended official domain.
4. Evaluate **Workshop Decision Receipt**: one browser page stores decisions and exports JSON. Expect feasibility pass with actual relevant storage/export documentation. Do not predetermine novelty. Documentation URLs in the input are leads, not evidence until read.
5. Evaluate **Card Board**: local kanban columns/cards, labels, due dates and drag-and-drop, with explicitly no differentiator. Expect novelty fail after reading a close existing project.
6. Evaluate **Permission-free Voice Recorder**: a normal webpage must record after explicit microphone denial, with every alternate path excluded. Expect an evidenced feasibility fail.
7. Investigate only whether getUserMedia permits capture after denial. Expect a sourced blocker answer.
8. Audit actual source excerpts and generated claims separately from schema/identity checks. Keep original failures and distinguish execution errors, unresolved evidence, and business rejection.
9. After the last suite exposed an investigation direction error, fix only its native submission representation and rerun that case. The evaluate path was unchanged after the latest suite.

## Latest complete suite and focused retest

The full suite ran around **12:26–12:28 a.m. America/New_York**, approximately **115 seconds**. The focused retest ran at **12:31 a.m.** Directory timestamps use UTC.

| Check | Harness result | Returned result | Time | Searches / reads | Generation requests | Tokens |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Missing-time preflight | Pass | needs_input; no passed field | 0.006 s | 0 / 0 | 0 | 0 |
| Service smoke | Pass | HTTP 200 model list; correct JSON marker; MDN body read | About 5.6 s¹ | 1 / 1 | 1 | 59 |
| Workshop Decision Receipt | Pass | ok; novelty insufficient_evidence, feasibility pass; passed=false | 30.895 s | 2 / 4 | 5 | 65,540 |
| Card Board | Pass | ok; novelty fail, feasibility pass; passed=false | 25.402 s | 2 / 2 | 4 | 40,307 |
| Permission-free Voice Recorder | Pass | ok; novelty insufficient_evidence, feasibility fail; passed=false | 26.669 s | 3 / 2 | 5 | 56,481 |
| Investigation, full suite | **Fail** | ok and a “No” answer, but wrong outcome=support | 26.225 s | 3 / 3 | 5 | 52,872 |
| Investigation, after fix | **Pass** | ok; sourced “No”; outcome=blocker | 16.971 s | 2 / 2 | 3 | 20,248 |

¹ Service duration is approximate, derived from event timestamps; the summary has no dedicated service elapsed-time field. Generation counts exclude model-list HTTP requests.

All three real evaluation samples returned passed=false: the decision receipt had insufficient novelty evidence, the kanban idea failed novelty, and the recorder failed feasibility. The both-tests-pass → passed=true calculation is covered by offline checks; this real test set contains no sample with both business tests passing.

The **six-case validation snapshot** uses the first five passing rows from the complete suite plus the focused investigation: **18 generations, 182,635 tokens and 21 retrieval calls**, including two service-smoke calls. The SDK model-cost estimate is **US$0.029943768**.

The complete suite alone, including its failed investigation, recorded **20 generations, 215,259 tokens, 23 retrieval calls**, and an SDK estimate of **US$0.032042844**. Estimates are not account billing statements and exclude Tavily charges.

Evidence: [full suite summary](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/summary.json), [full event trace](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/events.json), [focused summary](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-31-32-861Z-investigate/summary.json), and [audit index](D:/Mhacks/agent/evaluator/live-results/audit-index.json). The index retains the failed suite row and separately identifies the passing observations used for acceptance.

## Interpretation and independent semantic audit

- **Decision receipt:** actual [decision-record repository](https://github.com/joelparkerhenderson/decision-record), [localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage), [createObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static) and [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) bodies were read. The model left novelty unresolved because a guidance/template repository did not establish a comparable offline product. Relevant APIs support the proposed implementation path; anchor-download behavior and quota remain unverified. This is documentation-based feasibility, with team resources supplied as claims.
- **Generic kanban:** the read [Aback Tools product body](https://abacktools.com/tools/productivity/planning/kanban-board) supports substantial overlap in users, problem and browser-local kanban solution. The input explicitly offers no meaningful difference. This fits the agreed duplicate rule; related products alone do not cause rejection. The report correctly says due dates are not described on that page, rather than proving their absence.
- **Impossible recorder:** actual [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and [WebRTC media-device](https://webrtc.org/getting-started/media-devices) bodies support permission-denial rejection. With no allowed fallback, the must-have requirement is blocked. Novelty remains unresolved.
- **Focused investigation:** the read MDN denial contract supports the final blocker. The answer explicitly leaves browser-specific re-prompt behavior and microphone Permissions API recovery unverified. Its public evidence grade is supported_by_source, separate from outcome=blocker.

Semantic audit still found minor limitations: the kanban comparison says “unlimited boards” although the excerpt supports unlimited columns/cards; its drag-and-drop implementation is supported by a team capability claim rather than a separately read official API body. Such details must not be treated as independently verified. Schema validity and matching citations do not guarantee semantic correctness.

## Failures retained and fixes

| Observed issue | Resulting change |
| --- | --- |
| Prose/fences, malformed JSON, missing warnings or nested result fields | Schema-defined submit_report tool; server-owned envelope; DeepSeek beta strict schemas; explicit prevalidation feedback. A rejected result remains rejected. |
| Tool available but ignored in favor of assistant text | First turn names a retrieval tool; later DeepSeek turns require a tool. |
| Unread competitor references or imagined searches | Bind IDs/URLs to actual request reads; require an actual search when budget permits. |
| Feasibility pass alongside unknown necessary dependencies, or documented conclusions with empty IDs | Reject the combination; explicitly identify missing evidence or unresolved dependencies in feedback. |
| Generic skill used as required API/data/device access proof | Keep team capability and available resources separate; input access dependencies require appropriate evidence/resource items. |
| Directory listings presented as individual implemented products | Reject known GitHub topic/search/listing URLs as competitor bodies; use public_web for web authorship not established by the ledger. |
| “Not mentioned” treated as “absent”; general permission example treated as universal behavior | Add explicit comparison and permission-scope rules; retain semantic-audit limitations. |
| Investigation “No” answer marked support | Native submission separates capability_outcome=available/blocked/unknown from evidence_basis; server maps these to existing draft/public fields. Focused retest confirmed blocker. |
| Unrelated storage page used as JSON-export proof | Positive-control assertions separately require relevant storage/export sources; known documentation leads still must be read. |
| Windows encoding and Tavily MCP JSON truncation on U+2028/U+2029 | UTF-8 subprocess; compatibility decoder treats only CR/LF as SSE line endings, preserving legal Unicode inside JSON strings. Installed CLI/auth files are unchanged. |

DeepSeek strict mode uses the documented beta endpoint, required object fields and additionalProperties=false. Only the remote schema removes unsupported length keywords; local validators retain their original constraints. Custom endpoints do not enable strict mode by default; EVALUATOR_STRICT_TOOLS controls compatibility. Strict schema compliance does not establish that a source supports a claim. See [DeepSeek's official Tool Calls documentation](https://api-docs.deepseek.com/guides/tool_calls/).

There is **at most one correction across invalid submissions and text fallback**, sharing the original tool/time/turn budgets. The blocker assertion may accept partial only when actual sources still support the required feasibility rejection; unrelated retrieval failure must not erase that documented blocker. The latest blocker returned ok, so this allowance was not used.

Retained history includes:

- **02:51 UTC:** the first complete live suite rejected all four model-driven cases with INVALID_OUTPUT.
- **03:30 UTC:** 5/6; duplicate malformed JSON. [Original summary](D:/Mhacks/agent/evaluator/live-results/2026-10-04T03-30-27-570Z-all/summary.json).
- **04:08 UTC:** typed submission still allowed investigation to stop in assistant text. [Summary](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-08-26-860Z-all/summary.json).
- **04:14 UTC:** submissions still omitted required verdict fields or cited nonofficial technical sources. [Summary](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-14-08-880Z-all/summary.json).
- **04:20 UTC:** positive sample claimed documented storage support without a read storage citation; correctly rejected. [Summary](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-20-45-836Z-all/summary.json).
- **04:25 UTC:** availability check mistakenly used beta/models and received an unusable response; fixed to standard /models. No model generation occurred in that attempt.
- **04:26 UTC:** strict schema suite passed 5/6; investigation direction was wrong despite a valid envelope.
- **04:31 UTC:** focused investigation passed after separating capability direction from evidence basis.

An earlier site:MDN smoke query also returned unrelated Cafe Flora results through the unmodified CLI; a simpler query returned relevant sources. Its cause remains unknown. A transient retrieval failure is retained without assigning an unproven quota/authentication cause.

Across **28 logged directories**, observed usage totals **190 generations, 1,746,653 tokens**, and an SDK estimate of **US$0.311661744**. The **187 recorded scenario retrieval calls** exclude service smoke and direct diagnostics. These are log totals, not complete account usage or Tavily credit calculations.

## Reproduce and inspect

After configuring the model key locally and authenticating Tavily CLI in the selected Python environment:

    cd D:\Mhacks\agent\evaluator
    $env:TVLY_PYTHON = 'python'
    node live-test.mjs all
    # Focused reproduction:
    node live-test.mjs investigate

The opt-in runner loads this directory's ignored .env. Normal pnpm test does not call real APIs. WSL requires its own available Node/Python/Tavily environment; this report establishes Windows execution.

Each case saves request, returned response, actual retrieval trace and public model-turn usage. Additional wire/content diagnostics contain public protocol data. Tool-feedback logs include results visible to a subsequent model turn; a terminal submission without another turn may have no feedback entry.

| Scenario | Exact input | API response | Retrieval trace | Public model trace |
| --- | --- | --- | --- | --- |
| Decision receipt | [request](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/feasible-request.json) | [response](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/feasible-response.json) | [tools](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/feasible-tools.json) | [turns](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/feasible-model-turns.json) |
| Duplicate | [request](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/duplicate-request.json) | [response](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/duplicate-response.json) | [tools](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/duplicate-tools.json) | [turns](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/duplicate-model-turns.json) |
| Blocker | [request](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/blocker-request.json) | [response](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/blocker-response.json) | [tools](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/blocker-tools.json) | [turns](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-26-23-907Z-all/blocker-model-turns.json) |
| Fixed investigation | [request](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-31-32-861Z-investigate/investigate-request.json) | [response](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-31-32-861Z-investigate/investigate-response.json) | [tools](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-31-32-861Z-investigate/investigate-tools.json) | [turns](D:/Mhacks/agent/evaluator/live-results/2026-10-04T04-31-32-861Z-investigate/investigate-model-turns.json) |

The ignored live-results directory must be retained locally for these evidence links to work.

## Remaining limits

No full suite was rerun after the investigation-only fix. Passing observations across these small controlled cases do not establish repeatable model quality or exhaustive originality checks. Public project claims may overstate capabilities, and bounded search can miss close products.

No proposed-project prototype or real microphone permission dialog was executed. Anchor download, browser quotas, drag behavior, permission recovery and detailed product-feature comparisons still need practical or semantic checks. Team skill/resource statements remain claims.

Gemini, Tavily direct HTTP, real Python-to-provider execution, uAgent/Agentverse/ASI:One registration, SpacetimeDB sessions/DAG persistence and authorization, and a deployed team workflow were not remotely exercised. Python bridge verification was local/offline. These results establish real DeepSeek/Tavily evaluator operation and conservative error handling, with the limits above.
