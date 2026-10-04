# Idea context and optional memory

The integrated workflow supplies complete authorized shared context and leaves Mem0 disabled. The Idea package separately implements a Mem0 HTTP client and SpacetimeDB context/job adapters.

## Source of truth

Workflow constructs the request after authentication: room constraints, approved profiles, shared discussion history, resolvable sources, human convergence and any current revision/review. A room ID alone is not authorization. Raw private interviews are excluded.

Mem0 can rank sources already present in this request. A recalled item must match room, `team_shared` visibility, source ID, object ID/version and the SHA-256 digest of the approved text. The agent receives the current authorized source text, not a Mem0-generated replacement. Unknown, revoked or changed sources are ignored. Memory failure leaves the full supplied discussion intact.

## Interfaces in memory.mjs

| Export | Purpose |
| --- | --- |
| createRoomMemoryScope | Stable same-room namespace; not an access grant |
| createMem0Client | Bounded search/add calls with fixed endpoints, no automatic retry or redirect |
| recallSharedMemory | Returns authorized sources and safe warnings |
| syncSharedSources | Trusted background synchronization of approved sources |
| createSpacetimeContextStore | Authenticated snapshot loading and conditional result commit |

Search/add use the implemented Mem0 v3 endpoints. Synchronization writes approved source text verbatim with `infer:false`. Store receipts and unknown outcomes before retrying interrupted remote writes. A changed authorization snapshot prevents stale content from re-entering the prompt; it does not automatically delete historical records at the external provider. Remote deletion needs its own data-lifecycle operation.

## SpacetimeDB

The [module](spacetime/README.md) provides real tables, permission views and reducers. Authenticated backends load authorized snapshots and commit results only when operation, request, input revision and lease ownership remain current. Database adapters are trusted server callbacks, not model tools or public browser write grants.

Shared context, jobs and receipts can be durable across worker restarts. PostgreSQL/SQLite in the application still owns private interviews, human events and identity. See [integration](../../workflow/INTEGRATION.md#optional-spacetimedb) for actual module preparation and configuration.

Offline package tests validate HTTP boundaries, source matching and reducer behavior. Deployment and current real-service acceptance must be recorded separately; a passing reducer unit test does not establish cloud persistence.
