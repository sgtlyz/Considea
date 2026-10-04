# Workflow design

This is the current four-role architecture. Earlier three-agent sketches are superseded.

## Human decisions

1. Interview each member privately. Produce an editable summary; only the member-approved projection is shared.
2. Compare the approved profiles and shared history. Select one important difference, or a clarification when the evidence does not establish disagreement.
3. Ask every affected member to answer. Members may reject the question's framing.
4. After the required answers in every round, starting with round 1, ask all members whether to generate or continue discussing. No fixed minimum number of discussion rounds is imposed.
5. Generate only after all members choose `converge`. Any `diverge` starts another round immediately.
6. Evaluate every candidate before opening review. Incomplete evidence remains visible as a partial report.
7. Accept only when all members accept the same candidate and evaluation version. An agreed small revision returns to Idea generation, followed by evaluation and new review. An agreed request for further discussion returns to Interview.

Small-revision instructions must match after trimming surrounding whitespace. Conflicting actions or instructions leave the room waiting; each person can update their choice. An administrator cannot cast a member's vote. An absent participant remains required; a permanently changed team should start a new room.

## Counters and versions

`discussion_round` starts at 1 and increases only when a new team discussion starts. It is separate from an individual's question batch, a Pi model/tool turn, an agent task attempt and a candidate version. Revision and retry do not advance the discussion round.

Workflow creates entity IDs, versions, source IDs, event records and timestamps. Agents return local keys and references to authorized input. They cannot invent an approval, assign a final candidate version or directly move the room to another phase.

## What counts as a difference

A difference materially affects the final project direction: target users, problem priority, product shape, technical approach, novelty versus usefulness, complexity or acceptable risk. Priority depends on impact and missing information, not a head count. A disagreement between two people can matter more than a minor preference held by many.

Binary questions have exactly two options; open questions have none. Clarifications also require human answers and never imply convergence.

## Context and memory

Each Interview call receives only that member's private history plus authorized shared context. Other roles receive approved shared profiles and a resolvable source catalogue covering prior discussions, answers, decisions and reviews. A complete discussion history does not authorize access to raw private interviews.

The workflow database stores authoritative room state, credentials, events, tasks, attempts and recovery. PostgreSQL is used in the dev cloud; SQLite supports local use. SpacetimeDB is an optional shared-board/Idea-job integration. Mem0 is an optional search index in the Idea package, not the source of truth, and is disabled in the integrated path.

## Output and evidence

The default is three candidates; the API allows one to five. Each candidate explains its users, problem, solution, scope, team contributions, tradeoffs, dependencies and source trace. The evaluator distinguishes documented support, member claims, blockers and unknowns. A search with no results does not establish global novelty, and documentation does not establish a working prototype.

See [HTTP workflow](workflow/README.md), [agent contracts](agent/contracts.md) and [integration](workflow/INTEGRATION.md) for executable interfaces and verification.
