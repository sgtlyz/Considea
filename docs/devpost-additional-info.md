# Considea — Devpost additional information

## Main track

Actually Intelligent (AI)

## Sponsor opt-in prizes

- Judged by an LLM: reasonable optional entry based on the current project; eligibility still follows the event's criteria.
- Fetch ASI:One Agent Challenge: the standalone Interview agent has documented registration and ASI chat testing. The full primary workflow inside ASI:One and separate Submission Agent registration are not confirmed. Do not claim the entire submission is complete.
- Trust the Process (Best use of Notability): the team confirms using Notability during the event; select this category and describe actual usage if requested.
- Figma Best Design: confirm specific design deliverables and category requirements.
- Useless AI / Dumbest Idea: optional novelty categories; the current project is presented as a practical team tool.

## Technology feedback — short field

DeepSeek powered our interviews and idea development, while Tavily supported web research. Consistent structured outputs and clearer retrieval limits would make agent integration easier.

## Universities and schools

University of Michigan

## Technology feedback — long field

DeepSeek helped us build private interviews, idea generation, and project evaluation. Our main integration challenge was keeping model outputs consistent with the required schemas; explicit validation feedback helped us recover from malformed responses.

Tavily provided search and page extraction for evaluating related projects and technical requirements. Making retrieval coverage and source limitations visible was important, especially when the available evidence was incomplete.

Vercel and Render hosted our frontend, backend, and PostgreSQL database. Coordinating deployments and preserving room state across backend changes were important parts of delivering a usable demo.

## .Tech domains

Pending confirmation. If no .Tech domain was registered during the event, use N/A or leave this optional field blank. A vercel.app URL is not a .Tech registration.

## AI tools used

The team confirms using DeepSeek, Tavily, Codex, Notability, Fetch.ai, and Cursor. For the AI-tools field, select DeepSeek, Codex / OpenAI, Cursor, and Fetch.ai / ASI:One when present. Put Tavily and any absent AI-tool names under Other if the form permits. Notability belongs in the sponsor/category information unless the team used a specific AI feature. Exact dropdown options have not been inspected.

## Generative AI model/API implementation

Yes. Considea uses generative AI to help teams discover and refine project ideas.

Our recorded live demo uses the DeepSeek API for three roles: an Interviewer that asks follow-up questions and summarizes each member's interests and constraints; an Idea Generator that proposes and revises project candidates from approved team context; and an Evaluator that uses Tavily search and extraction to research similar projects and technical requirements.

We chose this approach because brainstorming is open-ended: useful ideas depend on the people building them, and those ideas need to evolve through discussion and research. A Python workflow coordinates the services, validates structured outputs, and requires explicit member approvals before sharing summaries, generating candidates, or accepting a final project. Evaluation reports retain sources and acknowledge insufficient evidence.

The application also supports OpenAI as an alternative model provider through room-scoped credentials.

## Gemini Project Number

No documented Gemini API integration in the live demo. If not entering the Gemini API category, leave blank. A real Google Cloud project number is needed if entering.

## Sources

- Event prize list: https://mhacks-2026.devpost.com/ (read during preparation).
- Fetch mandatory requirements: https://www.fetch.ai/events/hackathons/mhacks-2026/hackpack
- Actual Fetch implementation evidence: agent/interview/agentverse/README.md
- Live-demo evidence: docs/DEV-ACCEPTANCE.md

These answers have not been entered or saved in Devpost. School and tool names are confirmed by the team. Fetch submission completion, Figma category requirements, and .Tech domain registration remain unconfirmed.
