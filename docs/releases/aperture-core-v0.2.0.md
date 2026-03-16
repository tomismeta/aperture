# Aperture Core SDK v0.2.0

Minor release for `@tomismeta/aperture-core`.

This release makes Aperture core easier to trust, easier to integrate, and easier to inspect.

For integrators, the happy path is sharper:

- `ApertureEvent in -> AttentionFrame out -> AttentionResponse in`

For operators and adopters, the engine is now more auditable:

- traces now show more of why a decision happened
- policy and continuity evaluation are more inspectable
- operator-facing judgment controls are clearer and more intentional

Under the hood, those improvements come from a cleaner SDK surface and a more modular judgment engine.

## Highlights

- sharpened the default SDK experience:
  - `ApertureEvent in -> AttentionFrame out -> AttentionResponse in`
  - tightened the public SDK surface so the simple loop stays primary
- improved decision auditability:
  - continuity rule evaluations are traced
  - policy gate evaluations are traced
  - policy criterion evaluations are traced
  - advanced judgment surfaces are cleaner and more intentional
- clarified operator control through `JUDGMENT.md`:
  - policy rule fields
  - ambiguity defaults
  - planner defaults
- established a stable core hot path:
  - `evidence -> policy gates -> evaluation -> policy criterion -> routing -> continuity -> frame -> feedback`
- modularized the main judgment lanes into named rules
  - continuity: 9 rules
  - policy gates: 5 rules
  - policy criterion: 6 rules
- added new explicit judgment rules for:
  - minimum dwell
  - decision-stream continuity
  - conflicting interrupts
  - operator absence
  - source trust
  - attention budget
- hardened planner and evidence boundaries
  - fixed surface-capability routing regressions
  - strengthened evidence-context validation
  - removed stale advanced-surface shims and dead decision branches

## Operator-facing config surface

`JUDGMENT.md` now cleanly supports:

- policy rule fields:
  - `auto approve`
  - `may interrupt`
  - `minimum presentation`
  - `require context expansion`
- ambiguity defaults:
  - `non blocking activation threshold`
  - `promotion margin`
- planner defaults:
  - `batch status bursts`
  - `defer low value during pressure`
  - `minimum dwell ms`
  - `stream continuity margin`
  - `conflicting interrupt margin`
  - `disabled continuity rules`

## Recommended tag

- `aperture-core-v0.2.0`
