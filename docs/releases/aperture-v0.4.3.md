# Aperture v0.4.3

`@tomismeta/aperture@0.4.3` is a product patch release that bundles the
`@tomismeta/aperture-core@0.8.0` deterministic semantic, observation, judgment,
and attention hardening into the installable Aperture CLI/TUI product.

The product surface remains the same: `aperture` is still the dependency-free,
bundled local operator surface. This release updates the embedded engine
behavior; it does not add a new command, adapter, runtime endpoint, install-time
dependency, or product package export.

## Highlights

- bundles the core `0.8.0` semantic and judgment engine
- carries the new host-neutral kernel behavior into the packaged runtime
- preserves the dependency-free product package stance
- keeps the `/work` ingress contract and product launch flow unchanged
- keeps Codex, Claude, OpenCode, Pi, runtime, and TUI code bundled inside the
  product binary rather than adding install-time package dependencies
- updates npm-facing docs to point at the current product and core release notes

## Operator-Visible Behavior

This release may change how the product routes noisy source-event streams
because the embedded core is more precise:

- routine observational failures can route more quietly when the payload is
  structurally informational rather than actionable
- source-window read-limit failures now carry bounded diagnostic observation
  facts such as partial evidence loss and narrow-scope recovery hints
- empty or outcome-only nonzero command exits are handled as bounded
  outcome-shaped failures when command ownership is explicit
- completed updates with blocker, ask, source-activity, or progress semantics are
  interpreted more consistently
- relation polarity for resolution, recurrence, regression, and supersession is
  stronger and more deterministic

The intent is a calmer product surface over messy agent output without making
adapter-specific strings part of production core logic.

## What Did Not Change

This release does **not** change:

- the product CLI entrypoint
- the global install command
- the host-neutral `/work` contract
- the product package dependency posture
- the explicit opt-in posture for Codex hooks
- the published `@tomismeta/aperture-core` SDK contract

## Validation

Validated with:

```bash
pnpm release:check
pnpm judgment:bench
```

`pnpm release:check` includes typecheck, lint, format, dependency audit,
contract/schema checks, boundary and architecture checks, kernel conformance,
kernel surface, kernel corpus, observation kernel scorecard, the full test
suite, judgment battle, packed SDK proof, and product smoke.

The standalone JudgmentBench run passed 2,801/2,801 assertions.

## Install

```bash
npm install -g @tomismeta/aperture
aperture
```

See:

- [Product README](../../packages/aperture/README.md)
- [Aperture Core SDK v0.8.0](./aperture-core-v0.8.0.md)
- [Aperture v0.4.2](./aperture-v0.4.2.md)
