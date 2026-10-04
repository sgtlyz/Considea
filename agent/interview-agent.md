# Interview

Operations: `interview.turn and interview.summarize`.

Input: one member's authorized private messages and approved shared context.

Output: private questions and an editable summary draft.

The workflow owns identity, human answers, approval, rounds, versions and persistence. This role cannot manufacture consensus, skip a human gate or write authoritative room state. Invalid output stops the task rather than advancing the room.

See [implementation and integration](interview/README.md), [shared contracts](contracts.md), and the [workflow design](../workflow_updated.md).
