# Aperture Core SDK v0.5.0

`@tomismeta/aperture-core@0.5.0` is a judgment-substrate release that tightens
semantic correctness, clarifies the public SDK shape, and cleans up the
surfaced lane contract.

## Highlights

- cuts over the public lane/read-model contract to:
  - `now`
  - `next`
  - `ambient`
- adds a curated public trace entrypoint:
  - `@tomismeta/aperture-core/trace`
- keeps the SDK organized into three clean interaction surfaces:
  - root engine loop
  - `/semantic`
  - `/trace`
- strengthens semantic provenance and ambiguity handling
- makes traces more legible and more explicit about:
  - source facts
  - inference
  - decision-bearing impact
  - context-only semantics
- improves cross-adapter semantic consistency for Claude Code, OpenCode, and
  Codex

## Why This Matters

This release makes Aperture feel more like a real reusable judgment substrate
and less like a repo-internal engine.

The biggest changes are:

- a cleaner public SDK
- a more coherent lane vocabulary
- stronger semantic correctness
- better explainability for consumers using trace output directly

The result is a core package that is easier to trust, easier to embed, and
easier to reason about across hosts.

## Breaking Changes

The public surfaced lane contract now uses:

- `now`
- `next`
- `ambient`

instead of:

- `active`
- `queued`
- `ambient`

That affects public view/read-model consumers and related trace lane fields.

This release also narrows the public `onTrace(...)` runtime shape to the curated
trace contract instead of leaking the richer internal trace snapshot.

## What Did Not Change

This release does **not** introduce:

- model calls in the hot path
- host-specific logic in core
- a broader root-package export surface
- workflow/runtime assumptions in the SDK

The judgment path stays:

- deterministic
- local
- inspectable

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
- [Aperture Core SDK v0.4.2](./aperture-core-v0.4.2.md)
