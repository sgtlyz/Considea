# Follow-up integration

Use `runInterview` from `service.mjs`. `definition.mjs` supports the shared v2.0 baseline and the dedicated Interview v2.1 extension. The integrated workflow sends v2.1 so follow-ups can include complete human decisions and reviewed candidate context.

## Modes

| Mode | Purpose | Context |
| --- | --- | --- |
| initial | First private interview | No follow-up context |
| followup | Clarify the reasons and acceptable tradeoffs behind answered differences | Difference, actual human answers and applicable convergence decision |
| reopened | Revisit a project after human review requests another round | Reviewed candidate, evaluation, human review and any related difference/answers |

The payload also includes `member_id`, private `messages`, `current_profile`, `shared_context`, `discussion_round`, and operation-specific limits or stop reason. `contracts/schema.mjs` exports the executable `upstream` and `extended` schema objects. The saved baseline `contracts/protocol-v2.0.schema.json` is an upstream snapshot; do not edit it to manufacture compatibility.

## Follow-up after a difference

The trigger is `difference_answers` or `human_diverge`. The difference and answer references must agree. Answering members must belong to the room, binary selections must name valid options, and an open answer or objection to the framing must include text. Actual event completeness and authentication are checked by Workflow before the agent is called.

Where supplied, `decision_result` carries the real human convergence/divergence conclusion. It cannot be inferred from tone or fabricated to justify a new interview. Ask about reasons, conditions and acceptable tradeoffs, not a repetition of an already answered question.

## Reopened review

The trigger is `review_more_discussion`. Include the current candidate, its full evaluation, and a review requesting more discussion. Candidate IDs/versions must match across candidate, review and report; evaluation references must also match. Missing reports, mismatched versions, empty human instructions and accept/minor-revision decisions are rejected at this entry point.

The evaluation includes its full content and an explicit `feasibility:{verdict,rationale}` projection. If the supplied report does not establish an overall verdict, use `unknown` with a reason; `complete` and `partial` are not feasibility judgments.

A technical blocker does not mean a member dislikes the project. Ask which smaller scope or alternative would be acceptable. After the interview, produce a private draft for approval, then return to negotiation and human answers. Do not jump directly to generation.

## Validation and examples

`definition.mjs` validates cross-object links in addition to schema shape. `service.mjs` validates response status/data consistency. Direct Pi callers must preserve those checks.

[Reopened example](examples/evaluation-reopened-v2.1.json) and other files in `examples/` are offline synthetic fixtures. Run `pnpm --dir agent/interview test`. Integrated live acceptance is recorded separately in [DEV-ACCEPTANCE.md](../../docs/DEV-ACCEPTANCE.md).
