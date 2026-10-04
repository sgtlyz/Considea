# Idea Generator

Operations: `idea.generate and idea.revise`.

Input: authorized shared history, a real convergence decision, or the current reviewed candidate.

Output: one draft per reserved slot, or a version-linked revision.

The workflow owns identity, human answers, approval, rounds, versions and persistence. This role cannot manufacture consensus, skip a human gate or write authoritative room state. Invalid output stops the task rather than advancing the room.

See [implementation and integration](idea/README.md), [shared contracts](contracts.md), and the [workflow design](../workflow_updated.md).
