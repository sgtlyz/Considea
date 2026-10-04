# Shared protocol

`protocol.schema.json` defines the shared request, response and human-event contracts. `fixtures/` contains paired examples for interviews, differences, generation, revision, evaluation and human events.

From the repository root:

```sh
python agent/interfaces/validate_contracts.py
```

The outer envelope uses `schema_version:"1.0"`. Shared payloads use contract 2.0. Integrated Interview has an additional dedicated 2.1 schema in its package; Idea's research 2.1 extension is independent. Do not infer compatibility from matching version numbers in different packages.

Keep fields, enums, validators and fixtures aligned. [contracts.md](../contracts.md) explains ownership; [workflow/README.md](../../workflow/README.md) documents the authenticated HTTP wrapper.
