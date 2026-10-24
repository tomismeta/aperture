# Aperture Core SDK v0.10.0

`@tomismeta/aperture-core@0.10.0` tightens the stateful judgment loop while
keeping one canonical semantic path and the existing public entrypoints.

## Judgment And Human Decisions

- Explicit source risk is a floor. Semantic hints cannot downgrade a high-risk
  source fact, and adapters preserve command facts for Core-owned generic
  command-risk inference instead of maintaining competing classifiers.
- Result-ready completion awareness remains quiet only when it is safe,
  non-blocking, and does not require a response. Completion metadata cannot
  override a high-consequence or human-required interaction.
- An approval that requires a reason cannot be auto-approved.
- Submitted answers for pending frames are checked before state, learning, or
  response listeners change. The checks cover response kind, offered choices,
  selection cardinality, form fields, and required reasons. Opt-in expired-response
  rejection remains in force; well-shaped answers for unknown or already-resolved
  interactions remain no-ops.

These changes preserve the normal event/frame/response loop while rejecting
answers that do not satisfy the request actually shown to the human.

## Owned State And Exact Retraction

Core owns snapshots of inputs and of the values returned through its getters,
return values, and listeners. Mutating a caller-owned event or one listener's
snapshot no longer changes Core state or another listener's data.

Values crossing the stateful boundary must be structured-cloneable. Functions
and other non-cloneable payloads are rejected; hosts should keep executable
behavior and transport objects outside event and capture data.

`core.retract(taskId, interactionId)` removes one exact live interaction without
fabricating an acknowledgement, approval, or other human response. Retraction
also withdraws that interaction's episode evidence and recomputes remaining
related attention. Adapters should use it for native resolution or withdrawal,
not submit a synthetic answer merely to clear a frame.

## Learning And Engagement

Learning checkpoints are serialized and idempotent. Repeated checkpoints do not
count the same interaction again, and later corrections reclassify its evidence
rather than adding a second interaction. Host-controlled source and tool keys
are handled without prototype-key collisions.

Per-interaction accounting is retained for the lifetime of a Core instance.
This is an explicit memory tradeoff for correct checkpoint and correction
accounting, not a claim of bounded lifetime storage.

Finite engagement expiry now notifies subscribers, so attention can refresh
without waiting for a later event. Non-finite durations are rejected, and long
finite durations do not overflow the native timer into a busy loop. Embedders
that supply custom clocks should use a consistent clock across their components.

## Migration From 0.9.0

- Check custom surfaces and recorded responses against the live response spec.
  Invalid choices, incomplete forms, missing required reasons, stale responses,
  and malformed captures can now fail where they were previously accepted.
- Replace synthetic cleanup responses with exact `core.retract(...)` calls.
- Treat returned views, frames, traces, captures, and listener values as
  snapshots. Use the supported mutation APIs rather than changing a returned
  object to influence Core.
- Keep event, response, capture, and metadata values structured-cloneable.
- Preserve explicit source risk floors and command-family facts when adapting
  host-native requests. Do not rely on a semantic hint to weaken source risk.

The root, `/evaluator`, `/kernel`, `/semantic`, and `/trace` export paths remain
unchanged. The stateless kernel remains host-neutral and deterministic; runtime
hosting, persistence, transport, and presentation remain outside it. The package
adds no runtime dependencies.

## Qualification

`pnpm release:check` includes the deterministic kernel, semantic-surface,
conformance, corpus, observation, holdout, scale, and judgment checks together
with the full test suite. `pnpm sdk:prove` builds and packs the SDK, installs it
into temporary external consumers, compiles and runs the public examples, and
checks that private implementation paths are not exported.

These are bounded regression and consumer-contract checks, not an independent
accuracy claim over arbitrary agent output.

## Related Releases

- [Aperture v0.10.0](./aperture-v0.10.0.md) bundles this engine in the CLI/TUI
  product and its separately delivered worker.
- [Core SDK guide](../../packages/core/README.md)
- [Previous Core release](./aperture-core-v0.9.0.md)
