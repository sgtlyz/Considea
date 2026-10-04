# Considea on Agentverse

The optional Agent Chat Protocol (ACP) adapter connects ASI:One conversations to
the existing workflow. It shares the website's room database, task runner, agent
implementations and human decision gates. Registration is separate from hosting:
listing an address does not make an unhosted agent usable.

## Current rollout

The new shared-workflow endpoints are implemented but have not yet been deployed
or registered. Do not claim they are available until the final checks below pass.
The older standalone Interview registration uses a different adapter and private
identity; this change does not replace its address or recover its missing seed.

| Agent role | Public endpoint | Existing implementation |
| --- | --- | --- |
| Interview (optional migration) | `/agentverse/interview/chat` | `agent/interview/service.mjs` |
| Negotiator | `/agentverse/negotiate/chat` | `agent/negotiate/service.mjs` |
| Idea Generator | `/agentverse/idea/chat` | `agent/idea/service.mjs` |
| Evaluator | `/agentverse/evaluator/chat` | `agent/evaluator/` through the integrated worker |

Each address is an entrance to the same room workflow. Visiting another agent
does not bypass the current phase. If ASI starts a different conversation session,
join with an unused invitation or recover your own membership there; recovery
invalidates the previous membership token. A user can also stay in one private
conversation for the whole workflow; the backend dispatches all four specialists.

## Deployment and registration

1. Install `workflow/requirements.txt` and the normal Node agent dependencies.
2. Create stable private identities once:

   ```sh
   python -m workflow.register_agentverse --init .agentverse-local/seeds.json
   ```

   This defaults to Negotiator, Idea Generator and Evaluator. Use repeated
   `--role` options to choose roles. Back up the file privately. To migrate an
   existing address, use its original seed; a new seed creates a different agent.
3. Set the private JSON map as `CONCLAVE_AGENTVERSE_SEEDS` on the existing live
   backend. Keep its stable `CONCLAVE_SECRET_KEY`, database URL, demo access code
   and current model/search credentials. The backend does **not** need the
   Agentverse account API key. Without the seed map, endpoints remain disabled.
4. Deploy with the existing integrated live runner. `/agentverse/status` exposes
   only mode, public names, addresses and endpoint paths. Ensure the seed-derived
   addresses match. Keep existing per-room and daily model budgets unchanged.
5. Select the intended Agentverse owner account. Save its API key in a private
   local file, then register explicitly:

   ```sh
   python -m workflow.register_agentverse --seeds-file .agentverse-local/seeds.json --base-url https://YOUR-BACKEND --key-file .agentverse-local/api-key.txt
   ```

   The CLI rejects offline or mismatched deployments. It writes public results to
   `docs/agentverse-agents.json` only after each confirmed registration. Retrying
   with the same seed preserves identity. Registration errors omit secrets.
6. Verify Active/ASI availability in Agentverse, then `/help` and a real private
   session in ASI:One. Record model versus fixture tests separately. Update the
   existing MHacks submission with the verified profile links; do not create a
   duplicate team submission.

## Chat flow

Ask `/help` for the complete command list. Each participant uses a separate
private ASI conversation. The lead creates a room:

```text
/create DEMO_CODE | alice,bob | Build a small hackathon project | 24
```

The lead joins as the first name and receives one invitation per teammate. Send
each invitation only to its intended recipient. The reply also contains private
membership and room-operator recovery information. Keep those out of public demos.

`/status` displays the current questions or decision. Answer the questions with
`/answer`, separating multiple answers with `|`. Review the generated draft,
correct it with `/edit` or `/drop`, and explicitly `/approve DRAFT_ID:VERSION`.
Unknowns in the draft are included in the approval. Only approved summaries are
shared with the team.

The Negotiator produces a difference. Use `/difference`, `/choose` for displayed
multiple-choice options, or `/disagree` to correct its framing. Rounds 1–3 return
to interviews after the required answers. From round 4, every member must choose
`/vote converge`; any `/vote diverge` reopens discussion. Candidates are generated
and evaluated asynchronously. Read the results with `/status`, then `/accept`,
`/revise` or `/discuss` using the displayed candidate version. Revisions require
fresh evaluation and approvals. `/brief` displays the accepted project brief.

The ACP adapter does not translate arbitrary natural-language requests into
approvals. ASI can explain the commands, but must ask the participant before
submitting an approval or vote. ACP authenticates the sending agent/session; it
cannot independently attest to the human intent behind ASI's outgoing message.

## Privacy, reliability and limits

- Signed envelopes are checked for sender, target, expiry, schema and message age.
  Acknowledgements do not trigger reply loops. Replies go only to the verified
  sender in the original session.
- Membership bindings use a hash of sender **and** session. Live bindings and
  cached replies are encrypted with the existing backend encryption key.
- Only the existing member-specific workflow view is rendered. Personal conflicts
  remain visible only to the affected participant.
- Durable message receipts prevent duplicate actions. A crash after receipt but
  before confirmation does not automatically repeat an uncertain action; inspect
  `/status`. Sessions are serialized and stale displayed decisions are rejected.
- Agent work stays in the existing durable task queue. Messages do not create a
  second model loop or change shared-call budgets. Use `/status` while tasks run.
- Chat and room creation are rate limited. ASI/Agentverse relay messages and the
  configured providers process task context; do not treat ASI as local-only storage.

Offline verification:

```sh
python -m unittest workflow.tests.test_agentverse -v
python -m unittest discover -s workflow/tests -v
```

References: [official uAgents registration guide](https://docs.agentverse.ai/documentation/launch-agents/agentverse-sdk/u-agents),
[MHacks hackpack](https://www.fetch.ai/events/hackathons/mhacks-2026/hackpack).
