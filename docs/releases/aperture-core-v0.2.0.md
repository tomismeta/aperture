# Aperture Core SDK v0.2.0

Minor release for `@tomismeta/aperture-core`.

This release hardens Aperture core into a cleaner SDK and a more modular judgment engine. The happy path is now sharper for integrators, while the internal engine lanes are more explicit, more inspectable, and easier to extend.

## Highlights

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
- improved trace visibility with:
  - continuity rule evaluations
  - policy gate evaluations
  - policy criterion evaluations
- tightened the public SDK surface so the default developer experience stays:
  - `ApertureEvent in -> AttentionFrame out -> AttentionResponse in`
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
