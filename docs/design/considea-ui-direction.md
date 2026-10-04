# Workspace design notes

The interface keeps the teammate's visual direction: restrained green/neutral colors, serif display type, a quiet animated background, light/dark themes and a focused working area.

## Reading order

1. Explain what the team is doing and how to enter.
2. Show connection and live/practice status before room creation.
3. Display the current discussion round and the next useful action.
4. Keep private interview work separate from approved shared summaries.
5. Put the current difference, candidate or review in the main column.
6. Show who still needs to act without treating silence as consent.
7. Present the accepted project as a readable brief; technical records remain optional details.

## Access and recovery

Invite links carry only the recipient's one-use invitation in the URL fragment. Recovery cards are private downloads. API key fields are masked, never restored from browser storage and cleared after successful submission. Administrator controls distinguish unjoined participants from identities that require their own recovery code.

## Interaction

Keep unsent text through polling, refresh and language/theme changes. A stale event refreshes the displayed state and asks for explicit resubmission. Show task failures near the next-step area and provide the existing retry action. Preserve every human gate in the architecture.

Keyboard focus is visible, tabs support arrow-key navigation, motion can be paused and the layout stacks on small screens. Source links open safely; user/model text is rendered as text, not trusted HTML.

## Demo presentation

A live room and a recorded replay must look distinct. The replay identifies synthetic participants, capture date and real model/retrieval use. It does not let a visitor mistake recorded progress for their own active room. Free-server startup delays should have a clear connecting state and a recorded fallback.

The earlier static prototype remains under `sites/considea-ui-preview`; production assets come from `workflow/web`.
