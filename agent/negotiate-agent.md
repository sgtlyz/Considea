# Negotiator

Operations: `negotiate.detect`.

Input: approved profiles and the shared source catalogue.

Output: one prioritized difference or clarification, with affected members and sources.

The workflow owns identity, human answers, approval, rounds, versions and persistence. This role cannot manufacture consensus, skip a human gate or write authoritative room state. Invalid output stops the task rather than advancing the room.

See [implementation and integration](../workflow/INTEGRATION.md), [shared contracts](contracts.md), and the [workflow design](../workflow_updated.md).
