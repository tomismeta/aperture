# Aperture Core SDK v0.6.0

`@tomismeta/aperture-core@0.6.0` is an attention-integrity release that keeps
the SDK small while making live judgment calmer, safer, and easier to trust.

## Highlights

- keeps the core judgment path cleaner by continuing the orchestration split
  around the engine without widening the public SDK surface
- adds operator engagement support so hosts can preserve current focus briefly
  while a human is actively interacting
- bounds ambient retention and prunes empty task state instead of letting stale
  passive history grow unbounded
- hardens the engine with broader exhaustive guards and stronger semantic test
  coverage

## Why This Matters

This release improves the two things that matter most for a reusable judgment
engine:

- the engine should stay understandable and stable at its boundary
- the live attention loop should feel calm instead of twitchy under pressure

In practice that means:

- better focus continuity while a human is engaged
- safer long-running state retention
- a cleaner core file boundary without moving semantics or judgment out of core
- stronger defensive checks against silent drift as the ontology evolves

## What Did Not Change

This release does **not** turn the SDK into a host runtime.

It does **not** add:

- HTTP routing
- local runtime hosting
- source-specific adapters
- TUI rendering concerns

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
- [Aperture Core SDK v0.5.0](./aperture-core-v0.5.0.md)
