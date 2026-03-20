# Aperture SDK Path

This document describes the current SDK shape and the rules that should govern
it going forward.

The goal is not to turn Aperture into a generic orchestration framework.
The goal is to let other runtimes adopt Aperture's judgment layer directly
without diluting the product.

## Purpose

The SDK path exists to make it possible to:

- embed Aperture's judgment stack inside another runtime
- preserve Aperture's deterministic and self-learning attention model
- keep the package surface smaller than the full product surface
- avoid coupling consumers to the local runtime host or TUI

The package path should broaden distribution, not redefine the product.

## Current State

Today, the real judgment layer lives in the [Aperture core SDK package](../../packages/core/package.json), published on npm as `@tomismeta/aperture-core`.

Current version:

- `@tomismeta/aperture-core@0.3.0` on this branch

What is already true:

- `ApertureCore` is exported and usable as a full engine surface
- `SourceEvent` ingestion now includes a built-in deterministic semantic layer
- the root public surface is intentionally minimal
- external-consumer proof paths exist
- `pnpm sdk:prove` verifies both external consumption and tarball shape

What is still maturing:

- ongoing support discipline for the published package
- feedback from real external consumers
- long-term boundary decisions around persistence helpers and any future advanced subpaths

## Design Principles

The SDK path should preserve the same product principles:

- small footprint
- zero runtime dependencies
- deterministic hot path
- inspectable reasoning
- optional learning persistence
- no coupling to any one adapter or host

The easiest failure mode here would be publishing too much.
The right package surface should expose judgment constructs, not internal churn.

## Current Package Shapes

### Aperture Core SDK

This is the main public SDK package.

It currently contains:

- the full engine facade for consumers who want the whole attention model
- core event, source-event, frame, response, signal, and semantic types
- a deterministic semantic layer used internally by `publishSourceEvent(...)`

It should not contain:

- transport servers
- local adapter registration
- terminal rendering
- source-specific adapters
- lower-level judgment primitives at the root package surface
- semantic helper internals at the root package surface

### `@aperture/runtime`

This remains an optional host package.

Its job is:

- own one `ApertureCore` instance
- expose a local process/runtime API
- manage learning persistence for the default product path

It should not become a requirement for SDK consumers.

## Two Integration Modes

### 1. Full Engine Mode

This is for consumers who want Aperture to own the attention model end to end.

They should be able to:

- construct `ApertureCore`
- publish `ApertureEvent` or `SourceEvent`
- receive `AttentionFrame`, `AttentionTaskView`, `AttentionView`, `ApertureTrace`
- submit `AttentionResponse`
- checkpoint and reload learned memory

This is the easiest integration path.

### 2. Advanced Or Friend Mode

This is not the default npm-consumer story.

Repo-internal packages can still use deeper core modules directly through the
workspace when they need rendering, runtime, or benchmark internals.

If real external demand emerges for advanced composition, it should appear as an
intentional secondary surface later, not as casual root-package sprawl.

## Public Surface Discipline

The public SDK surface should expose only what is conceptually stable.

Current emphasized exports:

- `ApertureCore`
- `ApertureEvent`
- `SourceEvent`
- `AttentionFrame`
- `AttentionTaskView`
- `AttentionView`
- `AttentionResponse`
- `AttentionSignal`
- semantic interpretation types
- current core event/source/frame/response/signal types

Still not recommended as primary public surface:

- internal task stores
- frame construction internals
- trace recording internals
- heuristic implementation details that may still move
- lower-level judgment pipeline components
- persistence helpers that are not required for the main SDK loop

## Learning Loop In The SDK

The SDK must preserve Aperture's learning loop, because that is part of the
wedge.

The loop is:

`signals -> memory -> utility -> planner -> presentation -> response -> new signals`

For SDK consumers, that means:

- `ApertureCore` should continue to record interaction signals
- persistence should stay optional

The package contract should be about learning persistence, not Markdown as a
product concept.

## Package Boundary Rules

To keep the SDK clean:

- the Aperture core SDK package must remain adapter-agnostic
- the Aperture core SDK package must not depend on `@aperture/runtime`
- the Aperture core SDK package must not depend on the TUI
- adapters should continue to translate source-specific events into Aperture contracts
- the runtime should continue to be just one host around core, not the only way to use it

## What Matters Next

The next SDK priorities are:

1. keep the README and npm-facing docs accurate
2. keep examples healthy as the engine matures
3. avoid expanding the public surface casually
4. support real external consumers based on actual friction

Longer-term questions still open:

- whether markdown/profile persistence belongs in the core package forever
- whether some persistence helpers should eventually move behind a narrower boundary
- whether a deliberate `advanced` or friend surface is needed later

## Success Criteria

The SDK path is successful when:

- another runtime can install the Aperture core SDK package and use it without vendoring the repo
- the same deterministic judgment stack works both in Aperture's own runtime and in an embedded host
- the learning loop still works outside the built-in runtime host
- Aperture remains clearly positioned as the judgment substrate, not as a generic agent framework
