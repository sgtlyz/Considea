# Evaluator

Operations: `evaluator.evaluate`.

Input: the current candidate, approved resources, explicit project time and finite research budget.

Output: a source-backed report with risks, unknowns and recommendations.

The workflow owns identity, human answers, approval, rounds, versions and persistence. This role cannot manufacture consensus, skip a human gate or write authoritative room state. Invalid output stops the task rather than advancing the room.

See [implementation and integration](evaluator/README.md), [shared contracts](contracts.md), and the [workflow design](../workflow_updated.md).
