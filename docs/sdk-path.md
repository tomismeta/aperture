# Aperture SDK Path

This document outlines how Aperture can become an embeddable package without changing what the product is.

The goal is not to turn Aperture into a generic orchestration framework.

The goal is to let other agent runtimes adopt Aperture's judgment layer directly.

## Purpose

The SDK path should make it possible to:

- embed Aperture's judgment stack inside another runtime
- preserve Aperture's deterministic and self-learning attention model
- keep the package surface smaller than the full product surface
- avoid coupling consumers to the local runtime host or TUI

The package path should broaden distribution, not redefine the product.

## Current State

Today, the real judgment layer already lives in [@aperture/core](../packages/core/package.json):

- `ApertureCore`
- `AttentionPolicy`
- `AttentionValue`
- `AttentionPlanner`
- `JudgmentCoordinator`
- `distillMemoryProfile`
- profile persistence
- trace evaluation

Those pieces are live and wired in the current engine path.

What is not ready yet:

- the package is not yet published
- first-release versioning and scope are still a product decision

## Design Principles

The SDK path should preserve the same product principles:

- small footprint
- zero runtime dependencies
- deterministic hot path
- inspectable reasoning
- optional learning persistence
- no coupling to any one adapter or host

The easiest failure mode here would be publishing too much.

The right package surface should expose judgment constructs, not internal implementation churn.

## Intended Package Shapes

### `@aperture/core`

This should be the main public SDK package.

It should contain:

- the full engine facade for consumers who want the whole attention model
- lower-level judgment primitives for consumers who want to integrate selectively
- profile and memory helpers for learning loops
- trace and replay helpers for evaluation

It should not contain:

- transport servers
- local adapter registration
- terminal rendering
- source-specific adapters

### `@aperture/runtime`

This should remain an optional host package.

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
- publish `ApertureEvent` or `ConformedEvent`
- receive `AttentionFrame`, `AttentionTaskView`, `AttentionView`, `ApertureTrace`
- submit `AttentionResponse`
- checkpoint and reload learned memory

This is the easiest integration path.

### 2. Judgment Primitive Mode

This is for consumers who already have their own runtime and only want Aperture's adjudication layer.

They should be able to use:

- `AttentionPolicy`
- `AttentionValue`
- `AttentionPlanner`
- `JudgmentCoordinator`
- `AttentionCandidate`
- `forecastAttentionPressure`
- memory/profile helpers

This lets another runtime keep its own task model while delegating attention judgment to Aperture.

## Minimal Public Surface

The first public SDK surface should expose only what is already conceptually stable.

Recommended exports:

- `ApertureCore`
- `AttentionPolicy`
- `AttentionValue`
- `AttentionPlanner`
- `JudgmentCoordinator`
- `AttentionCandidate`
- `AttentionFrame`
- `AttentionResponse`
- `ProfileStore`
- `distillMemoryProfile`
- `forecastAttentionPressure`
- `evaluateTraceSession`
- current core event/frame/trace/profile types

Not recommended for early public export:

- internal task stores
- frame construction internals
- trace recording internals
- heuristic implementation details that may still move

## Learning Loop In The SDK

The SDK must preserve Aperture's learning loop, because that is part of the wedge.

The loop is:

`signals -> memory -> utility -> planner -> presentation -> response -> new signals`

For SDK consumers, that means:

- `ApertureCore` should continue to record interaction signals
- `distillMemoryProfile` should remain available for distilling learned state
- `ProfileStore` should remain the default persistence helper
- persistence should stay optional

The storage format can change later.

The package contract should be about learning persistence, not Markdown as a product concept.

## Package Boundary Rules

To keep the SDK clean:

- `@aperture/core` must remain adapter-agnostic
- `@aperture/core` must not depend on `@aperture/runtime`
- `@aperture/core` must not depend on the TUI
- adapters should continue to translate source-specific events into Aperture contracts
- the runtime should continue to be just one host around core, not the only way to use it

## Rollout Plan

### Milestone 1: Public Export Surface

- remove `private: true` from `@aperture/core`
- keep the stable judgment primitives exported and treat them as the intended package contract
- add a package README
- add one basic SDK example

### Milestone 2: Integration Guides

- prove a packed-tarball install outside the monorepo
- add one full-engine example
- add one judgment-primitive example
- verify learning persistence in embedded environments

Status:

- built
- examples live in `examples/core-full-engine` and `examples/core-judgment-primitives`
- verification script is `pnpm sdk:prove`

### Milestone 3: First Consumer Readiness

- verify a clean install/build path outside this monorepo
- test that another runtime can import and use the package
- keep the API intentionally narrow
- keep the tarball limited to the published contract

Status:

- built
- `@aperture/core` now has package metadata, a package-local license, and a `files` whitelist
- `pnpm sdk:prove` verifies both external consumption and tarball shape

## Success Criteria

The SDK path is successful when:

- another runtime can install `@aperture/core` and use it without vendoring the repo
- the same deterministic judgment stack works both in Aperture's own runtime and in an embedded host
- the learning loop still works outside the built-in runtime host
- Aperture remains clearly positioned as the judgment substrate, not as a generic agent framework
