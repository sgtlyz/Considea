# Considea — Devpost submission

## About the project

## Inspiration

Four teammates. Five hours. One question: **what should we build?**

That's how our MHacks started. The four of us sat together, trying to come up with a project. We brainstormed, overthought, and got nowhere. The clock kept ticking, and we were still stuck at step zero.

Then our lack of an idea became the idea.

We decided to build the tool we wished we'd had five hours earlier: something that could help a team discover ideas, work through them, and turn a promising thought into a project worth building.

That became **Considea**. It starts by understanding each person, brings their perspectives into a shared discussion, and helps the team generate and refine ideas with research and feasibility checks. The final direction belongs to the people building it.

Our first users were already sitting at the table.

## What it does

Considea helps teams answer the question that cost us five hours: **what should we build together?**

Whether a team starts with a blank page or a handful of rough ideas, Considea gives the conversation a path forward:

1. **Understand the people.** Private AI interviews explore each member's interests, skills, goals, and constraints. Members edit and approve what they want to share.
2. **Find common ground.** Guided discussion surfaces differences that matter and gives everyone a chance to respond.
3. **Develop the ideas.** When everyone agrees to move forward, the system generates project candidates grounded in the team's discussion.
4. **Put them to the test.** Web research explores similar projects and technical requirements, helping the team assess what to keep, change, or investigate.
5. **Choose together.** Members can request revisions, continue discussing, or unanimously accept a project and export its brief.

The result is a concrete starting point for building, with the team's perspectives and decisions behind it.

## How we built it

We organized Considea around four roles: an Interviewer to understand each person, a Negotiator to surface differences, an Idea Generator to propose and refine projects, and an Evaluator to investigate them.

A Python workflow coordinates the process and records human decisions. The AI services run in Node.js using the Pi agent harness; the current Negotiator uses Python rules. Our live demo uses DeepSeek for model calls and Tavily for web research, with structured contracts and validation connecting each step.

We built the interface with HTML, CSS, JavaScript, and a WebGL liquid background. Private interviews and shared discussions have separate spaces, while restrained typography keeps the focus on the conversation.

PostgreSQL preserves progress and project versions. Vercel hosts the frontend, and Render hosts the backend and database. Invitations, recovery cards, and encrypted room-scoped API keys support access and recovery.

## Challenges we ran into

After spending five hours choosing a project, we had to build a system for the very process we'd struggled with.

One challenge was deciding when a team was actually ready to move forward. We made that an explicit human decision: every member must agree before generation, and a revised project requires fresh approval.

Another was giving the system enough context to help while keeping personal interviews private. Only member-approved summaries enter the shared discussion.

We also encountered malformed evaluator output during our live run. We improved validation feedback and recovered through an explicit retry, preserving the team's progress and review steps. Coordinating these services meant handling failures and restarts as carefully as the successful path.

## Accomplishments that we're proud of

We turned our own hackathon roadblock into a working product that connects private conversations, shared discussion, idea generation, research, revision, and final acceptance.

Our recorded end-to-end demo used real DeepSeek and Tavily calls with two scripted participants. It completed four discussion rounds, generated candidates, handled a revision, and exported a freshly accepted project brief. The saved room also survived a backend service replacement.

We're proud that members can shape both the ideas and the process. They control what they share, when to generate, and which version to accept.

We also created an account-free recorded walkthrough so judges can explore the experience without supplying API keys.

## What we learned

Our five-hour brainstorm reminded us how hard it can be to turn an open-ended question into a next step. That experience shaped Considea: start with the people, ask focused questions, and make room to revise.

Building it taught us that AI collaboration depends on clear boundaries. Private thoughts, shared information, model suggestions, and human decisions each need their own place.

We also learned to preserve uncertainty. Research can uncover useful evidence while leaving important questions unanswered. Considea keeps those gaps visible so teams can make an informed choice about what to build.

## What's next for Considea

We want to bring Considea to real hackathon teams and learn whether it helps them reach a useful direction sooner, with everyone involved. That means testing interview quality, improving discussion prompts, and measuring how teams use and revise the suggested ideas.

We also want to expand research coverage, connect accepted briefs to team planning tools, and strengthen long-term hosting and recovery.

Our goal is simple: help the next team spend more of their hackathon building the idea they chose together.

---

## Built with

python, javascript, html5, css3, node.js, postgresql, deepseek, tavily, webgl, vercel, render, docker

## Try it out links

- Website: https://considea.vercel.app
- Recorded walkthrough: https://considea.vercel.app/demo.html
- Repository: https://github.com/sgtlyz/Considea

## Project media

- Gallery image: docs/assets/considea-devpost-cover.png (1536 x 1024, PNG, 3:2, 1,960,487 bytes).
- Demo video source: workflow/web/demo.mp4.
- Current YouTube demo: https://youtu.be/d4RyloKY-rE
- Video demo link: requires uploading the MP4 to YouTube or Vimeo and using the resulting URL. No supported video URL is currently recorded in this project.

## Preparation notes

Based on the current repository documentation and implementation. Production website and demo page returned HTTP 200 during preparation; the GitHub remote resolves to the Considea repository. Content has not been entered or saved in Devpost because no Devpost browser tab is connected.
