# Aperture Core SDK v0.7.0

`@tomismeta/aperture-core@0.7.0` is an engine hardening release that keeps the
root SDK small while making judgment, explanation, and package boundaries
easier to trust.

## Highlights

- keeps the root package intentionally narrow while continuing the structural
  split of oversized core modules
- deepens semantic and coordination guardrails around:
  - negated semantic relations
  - low-confidence inferred signals
  - source-trust calibration
  - episode grouping and resurfacing context
- strengthens trace and explanation fidelity for advanced consumers
- continues tarball and external-consumer proofing through `pnpm sdk:prove`
- removes the published `./internal` subpath so workspace plumbing no longer
  leaks into the public npm SDK contract

## Why This Matters

The core package only earns trust if two things stay true:

- the public SDK surface remains small and legible
- the engine keeps getting safer and more inspectable without dragging runtime
  or adapter concerns into the package boundary

In practice that means:

- a cleaner package contract for external consumers
- stronger semantic judgment under ambiguous or weakly inferred signals
- better traceability when a consumer needs to inspect why Aperture routed an
  event the way it did

## What Did Not Change

This release does **not** turn the SDK into a host runtime.

It still does **not** add:

- HTTP routing
- local runtime hosting
- source-specific adapters
- TUI rendering concerns
- a public internal helper bucket

The SDK is still the in-process deterministic judgment engine:

`event in -> frame/view out -> human response in`

## Validation

Validated with:

```bash
pnpm typecheck
pnpm sdk:prove
pnpm release:check
```

## Install

```bash
npm install @tomismeta/aperture-core
```

See:

- [Core README](../../packages/core/README.md)
- [SDK Path](../product/sdk-path.md)
- [Aperture Core SDK v0.6.0](./aperture-core-v0.6.0.md)
