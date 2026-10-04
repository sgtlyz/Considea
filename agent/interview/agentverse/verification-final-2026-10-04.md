# Interview repair verification — 2026-10-04

## Result

A new local session completed five answered batches using real DeepSeek without model-call failures (10 calls). Synthetic human review removed two duplicate privacy items, corrected categories, approved, edited again to verify approval revocation, reapproved and exported 17 full-profile items and 8 summary items. Summary status: `ready`. This is a local controller pass, **not an ASI end-to-end pass**. The review script initially used unsupported category `preference`; it was rejected without changing state and then corrected to a supported category. No model call was needed for review/export.

77 Node tests and 5 Python transport/bridge tests passed. This authorization window used 21 calls; cumulative ledger: 73 calls and US$1.825 reserved, within 92 calls / US$2.30. Reservations are conservative application accounting, not measured provider charges.

## Repairs

- Unknown facts emitted in the item list are moved to unknowns before strict field/source checks; foreign evidence and unexpected approval fields remain rejected.
- Review supports category correction and numbered unknown correction/deletion. Every edit revokes prior approval and preserves history.
- Prompts distinguish willingness conditions, resources, skills, constraints and unknowns, and ask for unique item keys and complete JSON.
- All three budget guards accept the explicitly approved cumulative ceiling without resetting the persistent ledger.

## Connectivity findings

- An earlier no-model diagnostic and real `/help` response arrived through ASI successfully.
- After replacing the temporary tunnel, ASI reported unreachable without any incoming `/chat` request in the application trace.
- Direct public signed acknowledgement and the official Agentverse proxy both returned HTTP 200 during diagnosis. Unsigned requests were rejected with 401 as intended.
- The tunnel logged a QUIC inactivity timeout at 13:12:26 UTC; from 13:28:57 UTC it repeatedly returned `Unauthorized: Tunnel not found`. This establishes a later tunnel failure, but does not establish the root cause of all earlier ASI failures.
- Final ASI `/help` at 09:33 EDT failed. A successful status or acknowledgement probe does not establish full conversation reachability. Stable hosting and another ASI end-to-end run are still required.

## Limitations and shutdown

The model still duplicates facts and misclassifies some categories; structured validation cannot prove semantic correctness. Human review remains required. Malformed JSON is rejected, never repaired by guessing or automatically retried. Team followup/reopened flows were not live-tested in this run. No claim that all bugs are fixed or that competition submission is complete.

Temporary proxy tracking was reverted to the normal direct registration. Agentverse confirmed inactive at 09:34 EDT. Application and tunnel processes were stopped; port 8011 had no listener. The stopped deployment cannot initiate further DeepSeek requests; prior requests may still appear in provider billing.
