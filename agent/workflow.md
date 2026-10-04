# Workflow ownership

The application state machine lives in [`workflow/`](../workflow/). It authenticates people, constructs authorized agent requests, stores task attempts and validates human events. Agents cannot move a room forward on their own.

Read [the current architecture](../workflow_updated.md), [HTTP API](../workflow/README.md) and [integration guide](../workflow/INTEGRATION.md). These replace the original three-agent workflow sketch.
