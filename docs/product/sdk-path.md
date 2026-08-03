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

Current workspace package version:

- `@tomismeta/aperture-core@0.8.0`

Current published npm latest:

- `@tomismeta/aperture-core@0.7.0`

The workspace version and published npm latest can differ while a release branch
is under review. Treat the published npm package and the versioned release notes
as the source of truth for what external consumers can install today.

If you want the opinionated local CLI/TUI product, use `@tomismeta/aperture`.
If you want to embed the deterministic judgment loop in your own host or
workflow, use `@tomismeta/aperture-core`.

What is already true:

- `ApertureCore` is exported and usable as a full engine surface
- `SourceEvent` ingestion now includes a built-in deterministic semantic layer
- a pure evaluator subpath exposes one-claim deterministic judgment records
- a kernel subpath exposes the stateless host-neutral observation/judgment prefix
- trace/explanation now has a dedicated subpath for SDK consumers
- the only advanced public subpaths are `@tomismeta/aperture-core/semantic`, `@tomismeta/aperture-core/evaluator`, `@tomismeta/aperture-core/kernel`, and `@tomismeta/aperture-core/trace`
- the root public surface is intentionally minimal
- external-consumer proof paths exist
- `pnpm sdk:prove` verifies both external consumption and tarball shape

What is still maturing:

- ongoing support discipline for the published package
- feedback from real external consumers
- long-term boundary decisions around persistence helpers and any future advanced subpaths

## In-Process SDK Versus Running Product

There are two different ways to use Aperture, and they should stay easy to
separate.

### 1. In-process SDK

Use `@tomismeta/aperture-core` when you want to:

- construct `ApertureCore` directly
- publish `ApertureEvent` or `SourceEvent`
- render your own frames, views, and responses
- keep Aperture inside your own host, workflow, or UI process

This path does **not** require the Aperture product runtime.

### 2. Running Aperture product

Use `@tomismeta/aperture` when you want:

- the local CLI/TUI product
- the built-in runtime host
- product-owned persistence and troubleshooting flows
- optional local product ingress like `/work`

That local ingress belongs to the product/runtime surface, not to the core SDK.

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

### Root Package

This is the main engine surface:

- construct `ApertureCore`
- publish `ApertureEvent` or `SourceEvent`
- receive frames, views, responses, signals, and trace callbacks
- submit `AttentionResponse`

This surface should stay small and stable.

### `@tomismeta/aperture-core/semantic`

This subpath contains deterministic interpretation and normalization helpers.

It exists for consumers who want to:

- inspect the semantic read without running the full engine
- normalize `SourceEvent` into canonical `ApertureEvent`
- validate adapter output and semantic assumptions

### `@tomismeta/aperture-core/evaluator`

This subpath contains the pure deterministic judgment primitive.

It exists for consumers who want to:

- evaluate one `AttentionClaim` against explicit context, config, and clock input
- receive a versioned `AttentionDecisionRecord`
- preserve the claim timestamp while reading `record.evaluatedAt` for the evaluation clock
- pass current attention state through `context.current`
- inspect planned route, planned lane, evidence, policy, value, ambiguity, continuity, and reason codes

It does not apply events, mutate state, accept responses, replay sessions,
persist data, or report realized placement. Use `ApertureCore` for those
stateful engine behaviors.

### `@tomismeta/aperture-core/kernel`

This subpath contains the stateless host-neutral observation and observation
judgment prefix.

It exists for consumers who want to:

- map their own host event shape into `ApertureKernelEvent` outside core
- call `evaluateApertureKernelEvent(...)`
- receive a bounded finalized event projection, normalized observation,
  observation judgment contract, and versioned explanation reason codes

It does not export host adapters, mutate state, apply attention policy,
calculate continuity, accept responses, persist data, or render UI. Use the
evaluator subpath for pure claim-to-record attention decisions; use
`ApertureCore` for the full stateful loop.

### `@tomismeta/aperture-core/trace`

This subpath contains the public explainability contract.

It exists for consumers who want to:

- type `onTrace(...)` callbacks cleanly
- inspect why a route happened
- consume semantic provenance and impact in a stable way

The trace subpath is intentionally narrower than the workspace's internal trace
snapshot. It should expose explanation structure, not the full coordinator and
store internals.

### Aperture Core SDK

This is the main public SDK package.

It currently contains:

- the full engine facade for consumers who want the whole attention model
- core event, source-event, frame, response, signal, and semantic types
- a dedicated evaluator subpath for pure claim-to-record judgment
- a dedicated kernel subpath for host-neutral observation/judgment projection
- a dedicated trace subpath for explanation consumers
- a deterministic semantic layer used internally by `publishSourceEvent(...)`

It should not contain:

- transport servers
- local adapter registration
- terminal rendering
- source-specific adapters
- lower-level judgment primitives at the root package surface
- semantic helper internals at the root package surface

### `@aperture/runtime`

This remains an internal host package, not the primary SDK.

Its job is:

- own one `ApertureCore` instance
- expose the local product/runtime API used by the Aperture product
- manage learning persistence for the default product path
- provide the shared host surface used by adapters, the TUI, and product-local ingress like `/work`

It should not become a requirement for SDK consumers.
The main published SDK remains `@tomismeta/aperture-core`.

The practical rule is:

- if you are building on Aperture's judgment engine, depend on `@tomismeta/aperture-core`
- if you are using Aperture the product, run `@tomismeta/aperture`
- `@aperture/runtime` can stay independently managed inside the repo without becoming a separately supported npm integration surface yet
- the public HTTP integration story should stay centered on `/work` and `/work/response/{interactionId}`, not on the internal `/runtime/*` control routes
- repo-internal clients may use `@aperture/runtime/internal` for sanctioned private seams like runtime discovery or auth-token lookup, instead of reaching into sibling package source files

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
- semantic interpretation types via `/semantic`
- trace explanation types via `/trace`
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

## Host Constraints Versus Operator Behavior

SDK consumers can absolutely shape their own host behavior outside core.

But if the host never tells Aperture what it can actually render or accept, the
engine will still plan as if it is targeting the default richer surface.

That is why host constraints belong in the SDK contract.

This should stay separate from:

- explicit `APERTURE.md` preferences
- learned `MEMORY.md` behavior

Those are different concepts:

- host constraints describe what the surface can do
- `APERTURE.md` describes what the human explicitly wants
- `MEMORY.md` describes what Aperture infers from repeated signals

If those concepts blur together, the engine can learn the wrong lesson. For
example, a constrained host may suppress ambient work even when the operator
would prefer to see ambient items on a richer surface.

The product CLI keeps that boundary visible with `aperture config`: it reads the
active preferences and memory, reports ignored or invalid markdown, and suggests
copy-paste policy snippets. It intentionally does not apply suggestions
automatically; explicit preference changes should stay human-owned until
dogfooding proves that a confirm-before-apply helper is worth the extra surface.

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
