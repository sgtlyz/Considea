# Considea interface integration

The `feature/interface` landing page, procedural material, palette, responsive desk,
language control and theme control are used by the production frontend in `workflow/web/`.
The original `docs/design/considea-atmosphere.html` and `sites/considea-ui-preview/`
remain standalone historical prototypes with sample content. They are not the deployed app.

## Entry and identity

1. **Open workspace** opens the room forms. No account, OAuth or password login is implemented.
2. Create a room with member IDs, context, optional project time limit and search preference.
3. Save the returned administrator token and invitations. Distribute only each person's invitation to them.
4. Each person joins in their own tab with a room ID and invitation. Invitations are single use.
5. Save your own recovery token privately. Restore with the room ID and token after leaving.

The test login never supplies an identity or permission to the API. Administrator access
is separate from member access and cannot read private interviews or vote for a member.
Room tokens and unsent form drafts live in sessionStorage, scoped to this tab and identity.
Draft keys include the question batch, profile draft, difference or candidate/evaluation
version. Refreshes and language/theme changes retain drafts for that exact context; an
old draft is never applied to a new round or version. Leaving clears this session's token
and drafts. Local storage holds only appearance and language preferences.

## Data and actions

All workspace content comes from the authenticated `GET /api/rooms/{room_id}` RoomView.
The frontend has no fixed people, candidate ideas, evaluation scores or simulated votes.
Mock/offline/live mode is controlled by the backend and labelled separately from test login.
Agent-produced text is displayed as text, not executable HTML, and remains in its original
language when interface chrome switches between English and Chinese.

| Surface | RoomView data | Action |
| --- | --- | --- |
| Your perspective | `private.question_batch`, `private.draft`, `private.messages` | `interview.answer`, then explicit `profile.approve` |
| Starting points | `shared_context.profiles` | Only approved text is shown |
| Team progress | `members`, `answers`, `votes` | No inferred agreement |
| Discussion | `difference`, `event_revisions.difference` | `difference.answer` |
| Convergence | `discussion_round`, `votes` | `convergence.vote` from round 4, after required answers |
| Candidate tabs | `candidates`, `evaluations`, `evaluation_details` | Select a real candidate ID/version |
| Version review | `reviews`, `event_revisions.review` | `candidate.review`: accept / minor_revision / more_discussion |
| Brief | `final_output` | Export only the persisted, unanimously accepted result |
| Activity / recovery | `tasks`, `calls_started`, `paused_reason` | Existing retry, budget, time-limit and stop endpoints |

Mutations use contract 2.0 events, unique event IDs, authenticated member identity and
expected revisions from the displayed RoomView. Revision conflicts refresh the room and
retain drafts for the same question/version, requiring explicit resubmission. The page
refreshes every 10 seconds; configured SpacetimeDB rooms additionally use the authenticated
SSE progress stream. Updates restore active fields without freezing other members' progress.

The workflow's human gates and unanimous decision policy are unchanged. Small revisions
create a new candidate and report version and require fresh human reviews. The prototype's
sample stance buttons are replaced by the existing workflow decisions.

## Access and next actions

The workspace shows live/practice mode, current discussion steps and a next action. Live rooms can use a team access code or room-specific DeepSeek/Tavily keys. Keys are masked, cleared on success and never copied into browser storage.

Invite links use a URL fragment and are cleared from the address bar when read. A new unused invitation replaces its predecessor. Joined people recover with a private card; recovery rotates the session token and code. Administrators cannot take over a joined identity. Away status is visible and never replaces the person's required consent.

Accepted briefs show readable scope and evaluation text, source links and an optional structured record. API keys and recovery controls are separate from discussion content. The browser test also checks invitation links, recovery/revocation, availability and key-field handling.

## Serving and verification

`deploy/build-frontend.mjs` copies `workflow/web/` to the Vercel output. The Python server
serves the same HTML and an explicit allowlist of `app.js`, `atmosphere.js`, `style.css`.
No repository directory or secret is exposed through static paths.

`node workflow/node/interface-smoke.mjs` starts its own temporary local mock server,
database and browser. Install Playwright (or set `PLAYWRIGHT_MODULE` to an existing module).
It tests the browser-to-HTTP-to-SQLite flow: room creation, invitation join, admin isolation,
drafts across refresh/language/theme, four human discussion rounds, candidate tabs, mobile
layout, escaped user content, revision/re-evaluation, unanimous acceptance, export and logout.
No live model/search API is called. GitHub Actions runs this test with a pinned browser.

`workflow/node/browser-smoke.mjs` remains the companion test for integrated teammate
agents, native evaluator reports, explicit project time and SpacetimeDB SSE (or the
`CONCLAVE_TEST_POLLING=1` fallback). Point it only at a disposable local integrated server.
