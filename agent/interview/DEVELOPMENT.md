# Interview development

Work on a feature branch and preserve teammate edits. Most changes belong in `agent/interview/`; shared harness changes belong in `agent/pi-base/` and must remain compatible with other roles.

1. Check [the role boundary](../interview-agent.md), [contracts](../contracts.md) and a concrete input/output example.
2. Change interview strategy in the role definition and deterministic limits in the service. Never generate approval, member intent or consensus as authoritative state.
3. Run `pnpm --dir agent/interview test`. Test the affected behavior: no initial idea, uncertainty, refusal, subjective objections, learning goals and a focused follow-up.
4. If live calls are authorized, record model, date, bounded requests and error categories. Keep keys, private transcripts and internal reasoning out of public reports.
5. Hand the workflow owner valid requests/responses and explicit failure examples. Coordinate contract changes across schema, fixtures and adapters.

The versioned [development skill](skill/SKILL.md) assists development; it is not an application agent and does not grant the model filesystem or shell access.

Offline tests cover structure and control flow, not interview depth or summary faithfulness. Full-team authentication, storage recovery and multi-agent behavior are tested at the workflow level.
