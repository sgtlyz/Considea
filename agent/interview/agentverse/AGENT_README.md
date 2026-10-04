# Considea Interview

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Turn an uncertain hackathon idea into a reviewed personal preference profile that a team can actually use.

This is the Interview component of **Considea**, a multi-agent system with Interview, Negotiate and Evaluator agents. The team is registering the components incrementally; this listing covers Interview first and belongs to the same Considea project.

The agent interviews one participant, saves a detailed profile after each answer, lets the participant correct it, and exports an approved full profile plus a compact handoff summary. It records skills, ideas, pains, preferences and participation conditions. It does not choose an idea on the team's behalf.

## Use in ASI:One

1. Ask: **Start a hackathon preference interview.**
2. Answer the questions. Default: up to five answered batches, at most three questions per batch. Send `/finish` to end early.
3. Inspect `/profile`. During review, use `/edit 1 replacement text`, `/drop 1`, or `/short 1 concise wording`.
4. Copy the exact `/approve <revision> <token>` command from the review message after checking the profile.
5. Use `/export` to retrieve the approved JSON handoff in the same conversation.

The summary holds up to eight items, each up to 80 Unicode characters, with references to the full profile. Hard constraints and participation conditions are prioritized. If these cannot fit, the summary is marked `needs_review`; it is not silently presented as complete. The full profile retains all approved items.

## Actions and data handling

The service creates and updates versioned records on disk, checks contracts, deduplicates messages across restarts, invalidates approval after edits, and generates a structured export. Human approval is enforced by the workflow, outside the language model.

Raw answers and draft profiles are stored on the operator's server. Live interviews send their content to DeepSeek. The chat platform also processes messages. Nothing is automatically sent to teammates or a Negotiate Agent. Only participant-approved items enter the export; internal transcript references are removed. Treat this as a hackathon prototype, not a production service for sensitive information.

This independently callable component prepares personal profiles for Considea's negotiation workflow. Competitor research and feasibility evaluation belong to Evaluator; team negotiation belongs to Negotiate. Automatic handoff from this ASI adapter to those agents is not connected yet. Runtime availability and model calls are limited by the operator's configured test budget.

[Source and run instructions](https://github.com/sgtlyz/Considea/tree/agent/interview/agent/interview/agentverse)

The registration script appends the actual agent address when publishing this listing.
