# Aperture Core SDK v0.4.2

`@tomismeta/aperture-core@0.4.2` is a semantic robustness patch release.

This cut improves how Aperture interprets imported agent traces without
changing the public SDK shape.

## Highlights

- reclassifies observational read and edit failures more accurately
  - routine readback output no longer looks like a critical failure by default
- tightens semantic risk phrase matching to reduce false escalation from loose
  substring matches
- adds semantic provenance so a consumer or reviewer can see whether a field
  came from:
  - source facts
  - deterministic inference
  - explicit hints
- adds semantic impact tracking so traces can separate:
  - decision-bearing fields
  - explanatory-only fields

## Why This Matters

The biggest quality improvement in this release is that Aperture gets calmer
around imported coding-agent traces.

Some public corpora report routine file readbacks as `failed`, even when the
tool clearly returned useful file contents. Before this patch, those could be
surfaced as higher-consequence failures than they deserved.

`0.4.2` makes that class of judgment more accurate while keeping the hot path:

- deterministic
- local
- inspectable

## What Did Not Change

This release does **not** widen the public SDK contract.

It does **not** add:

- new runtime dependencies
- host-specific logic in core
- model calls in the judgment path
- a broader root-package export surface

## Validation

Validated with:

```bash
pnpm exec tsx --test packages/core/test/semantic-normalization.test.ts packages/core/test/trace-recorder.test.ts
pnpm typecheck
pnpm release:check
```

The surrounding F-Stop pre-release sweep also completed on fresh unseen lanes
before this cut:

- `swe-smith/xml`
- `open-agent-sessions/approved`

## Install

```bash
npm install @tomismeta/aperture-core
```

See:

- [Core README](../../packages/core/README.md)
- [SDK Path](../product/sdk-path.md)
- [Aperture Core SDK v0.4.1](./aperture-core-v0.4.1.md)
