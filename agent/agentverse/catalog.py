"""Public metadata for the four interfaces to the integrated Considea workflow."""
ROLES = {
    "interview": ("Considea Interview", "Privately answer project-preference questions, review your draft, and explicitly approve what the team can see."),
    "negotiate": ("Considea Negotiate", "Resolve evidenced differences in approved team preferences and record each member's discussion and convergence decisions."),
    "idea": ("Considea Idea", "Generate and revise project candidates after the team's authorized convergence decision; inspect the resulting candidate versions."),
    "evaluator": ("Considea Evaluator", "Inspect source-backed novelty and feasibility research for team candidates and record version-specific human review decisions."),
}


def readme(role):
    name, description = ROLES[role]
    return f"""# {name}

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

{description}

One component of the four-person Considea project. This ACP interface connects to
the integrated Workflow backend, which executes the actual Interview, Python
Negotiator, Idea Generator and Evaluator implementations. These are four role
interfaces to one workflow, not four independent copies of a language model.

Start with `/help`. Join a team with `/join ROOM_ID ONE_USE_INVITATION`.
The invitation grants access to one member only. Never paste provider API keys.
Use `/status` to retrieve your authorized questions, draft, differences, candidates
and reports. `/event {{...}}` submits an explicit human event from the documented
Considea v2 contract. `/export` returns only the unanimously accepted final brief.
Use `/handoff ROLE` and `/resume CODE` to transfer your own member connection to
another role without reusing the consumed invitation. Codes expire in 10 minutes.
`/create {{...}}` accepts room_context, config, and a team access_code, when enabled
by the deployment operator. It returns one-use member invitations. No custom
frontend is required for these operations.

The engine, not model text, checks identities, input revisions, privacy, four
discussion rounds, unanimous convergence, and final candidate acceptance. Missing
approvals never count as consent. Research may return insufficient evidence.
Use a separate private ASI conversation per participant. Signed ACP sender and
conversation identify a transport session; the one-use invitation determines
the member. A public or shared ASI conversation is not appropriate for private
interview answers or invitations.

Source: https://github.com/sgtlyz/MHacks
Workflow contract: https://github.com/sgtlyz/MHacks/blob/master/workflow/README.md
"""
