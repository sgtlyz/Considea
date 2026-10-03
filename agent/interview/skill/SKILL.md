---
name: mhacks-interview-dev
description: Develop and test the MHacks Interview Agent on its agent/interview branch, including Pi integration, DeepSeek, private interview flow, and workflow handoff.
---

# MHacks Interview Development

Apply to this project's Interview Agent only. Locate the checkout containing `agent/interview/package.json`; the current machine's checkout is `D:/AI/Hackathon/Mhacks/mhacks-product`. Work on `agent/interview`, preserving existing changes. Do not change the collaboration model or application model based on each other's settings.

Read `agent/interview/README.md` for commands and payloads. For strategy changes read `agent/interview-agent.md`; for cross-role fields read `agent/contracts.md`. The runnable definition and this README specify `round_index` as answered batches: 0 before the first questions; seven answers must never cause an eighth batch.

Use the existing Pi core through `service.mjs`. Edit interview strategy/validation in `definition.mjs`; workflow owns counters, approval, versions, and visibility. Negotiate supplies the followup goal; Evaluator owns research. Interview receives only authorized current-member history and explicitly shared context.

Use `pnpm --dir agent/interview test` and the offline `demo`/`chat` before live testing. Fixtures test structure and program behavior, not conversational quality. Keep cases for subjective objection, unknown skills, private drafts, edited approval, member isolation, repeated answers, round caps, and provider errors meaningful when those paths change.

The user's current instruction is to request a DeepSeek API key when real testing is ready. Do not search unrelated files or reuse another project's credentials. Ask for local environment configuration and a finite live-test budget at that point; reuse authorization once provided. `live-smoke.mjs --live` performs at most two requests. Normal tests are offline and must not silently call DeepSeek. See README for the local `.env` command; never print or commit the key.

Report separately what passed offline, what was tested with DeepSeek, and what still needs the team's authenticated/persistent workflow. Keep this branch scoped to the single Interview Agent. Do not merge or push to master without user authorization for that change.
