# Dev release acceptance

Work stays off master. Each feature branch is tested, committed and pushed before merging into dev.

| Requested item | Completion evidence to collect |
| --- | --- |
| 4. Database deployment | Cloud primary database; state survives application replacement; shared sync verified if configured |
| 5. Usable interface | Guided creation/join, clear next action, readable reports, mobile and keyboard checks |
| 6. English repository | Current English product/setup/API docs, historical claims removed or explicitly archived |
| 7. Bring your own keys | Room-scoped encrypted keys, validation, replacement/removal, no disclosure or cross-room leakage |
| 8. Real testing | Live model + retrieval, at least two isolated participants, four rounds, revision and final approval |
| 9. Identity and recovery | Safe invite links, private recovery, token rotation, clear handling when a participant is absent |
| 10. Public limits | Durable rate limits and finite shared-key budget; concurrency and bypass checks |
| 11. Judge/demo readiness | Guest replay of a real completed run, clear replay label, setup guidance, error recovery |
| Video | A short recording of a successful real run, with any time compression labelled |
| Delivery | Feature commits pushed; dev contains the work; master unchanged; preview URL and verification notes |

Status is documented with evidence after verification, not inferred from this checklist.
