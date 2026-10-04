# Agentverse deployment status — 2026-10-04

The optional Render ACP integration is prepared on `deploy/agentverse-agents`,
based on master `a8fb08f`. It mounts four identities on the existing HTTP server
and stores encrypted adapter state in the existing database. No public endpoint
or Agentverse registration has been changed by this release yet.

Local validation: gateway and hosted transport tests pass, including signed HTTP
delivery, private identity restoration, role handoffs, replay protection and
existing Workflow authorization checks. PostgreSQL adapter persistence is also
included in CI with a disposable database; a local PostgreSQL test is skipped
when no disposable test URL is configured.

Deployment is pending access to the Render workspace owning `considea-dev-api`.
Registration and ASI validation must follow deployment; listing visibility alone
does not establish live operation. No live provider acceptance or competition
submission is claimed.

Follow [deployment and rollback instructions](README.md). Keep creation disabled
during transport verification. Test funded flows only with a bounded allowance.
The initial adapter uses structured workflow events; a polished natural-language
conversation remains separate work.
