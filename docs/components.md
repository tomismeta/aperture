# Components

This document describes the current Aperture component model after the slimming pass.

The intent is simple:

- keep the public product surface small
- keep internal engine pieces clear
- separate the engine from the shared runtime, adapters, and companion surfaces

## Classification

### Core Product

These are part of Aperture itself.

#### `ApertureCore`

- Classification: engine facade
- Lives in [packages/core/src/aperture-core.ts](../packages/core/src/aperture-core.ts)
- Purpose: the main engine entrypoint
- Owns:
  - semantic normalization of adapter inputs
  - ingesting `ApertureEvent`
  - ingesting `SourceEvent`
  - producing `AttentionFrame`
  - producing `AttentionTaskView`
  - producing `AttentionView`
  - accepting `AttentionResponse`
  - recording `AttentionSignal`
- Can be used directly:
  - with native `ApertureEvent`s
  - without any adapter package
- Does not own:
  - rendering
  - transport protocols
  - source-specific transport or storage formats
- Optional persistence boundary:
  - can load and checkpoint compact Markdown-backed judgment state through `ProfileStore`
  - still keeps raw runtime state in memory

#### `@aperture/runtime`

- Classification: shared host
- Lives in:
  - [packages/runtime/src/runtime.ts](../packages/runtime/src/runtime.ts)
  - [packages/runtime/src/runtime-client.ts](../packages/runtime/src/runtime-client.ts)
  - [packages/runtime/src/adapter-client.ts](../packages/runtime/src/adapter-client.ts)
  - [packages/runtime/src/runtime-discovery.ts](../packages/runtime/src/runtime-discovery.ts)
- Purpose: own one live `ApertureCore` instance and expose source-agnostic APIs for adapters and surfaces
- Owns:
  - one shared `ApertureCore`
  - runtime control API
  - adapter registration and liveness
  - source-event ingestion
  - surface attachment and response routing
  - local runtime discovery
- Does not own:
  - source-specific mapping
  - rendering
  - semantic policy beyond what `ApertureCore` already decides

#### `ApertureEvent`

- Classification: ingress contract
- Lives in [packages/core/src/events.ts](../packages/core/src/events.ts)
- Purpose: normalized machine or agent event entering the engine
- Owns:
  - task identity
  - source identity
  - event type and timestamp
  - human-input request payloads
- Does not own:
  - attention judgment
  - grouping
  - display logic

#### `SourceEvent`

- Classification: source-to-core ingress contract
- Lives in [packages/core/src/source-event.ts](../packages/core/src/source-event.ts)
- Purpose: source-agnostic factual input produced before core applies semantic normalization
- Owns:
  - task and interaction identity
  - source identity
  - request payloads and context
  - factual hints like `riskHint`
- Does not own:
  - final Aperture `tone`
  - final Aperture `consequence`
  - attention judgment

#### `AttentionFrame`

- Classification: atomic interaction contract
- Lives in [packages/core/src/frame.ts](../packages/core/src/frame.ts)
- Purpose: one bounded human-facing interaction
- Owns:
  - semantic mode
  - tone and consequence
  - summary/context/provenance
  - response affordances
- Does not own:
  - cross-task grouping
  - rendering details
  - orchestration across many frames

#### `AttentionResponse`

- Classification: return contract
- Lives in [packages/core/src/frame-response.ts](../packages/core/src/frame-response.ts)
- Purpose: explicit human response back into the engine
- Owns:
  - approval/rejection
  - choice submission
  - form submission
  - dismissal
- Does not own:
  - implicit behavioral interpretation
  - attention scoring

#### `AttentionTaskView`

- Classification: task-scoped grouped state
- Lives in [packages/core/src/frame.ts](../packages/core/src/frame.ts)
- Purpose: local coordination state for one task
- Owns:
  - `active`
  - `queued`
  - `ambient`
- Does not own:
  - cross-task prioritization
  - rendering

#### `AttentionView`

- Classification: host-facing grouped attention state
- Lives in [packages/core/src/frame.ts](../packages/core/src/frame.ts)
- Purpose: one cross-task view of what deserves attention now
- Owns:
  - current active frame
  - queued frames
  - ambient frames
- Does not own:
  - rendering
  - source-specific logic

#### `AttentionSignal`

- Classification: behavioral signal contract
- Lives in [packages/core/src/interaction-signal.ts](../packages/core/src/interaction-signal.ts)
- Purpose: capture explicit and implicit interaction behavior
- Owns:
  - presented/responded/dismissed/deferred/context-expanded events
  - timestamps and optional latency
- Does not own:
  - final prioritization decisions by itself

### Internal Engine

These are part of the core implementation, but not the product surface to emphasize.

#### `EventEvaluator`

- Classification: semantic evaluator
- Lives in [packages/core/src/event-evaluator.ts](../packages/core/src/event-evaluator.ts)
- Purpose: convert semantically normalized `ApertureEvent` into candidate interactions
- Boundary:
  - decides what interaction a raw event implies
  - does not decide whether that interaction wins attention

#### `JudgmentCoordinator`

- Classification: attention adjudicator
- Lives in [packages/core/src/judgment-coordinator.ts](../packages/core/src/judgment-coordinator.ts)
- Purpose: decide activate vs queue vs ambient vs keep
- Boundary:
  - owns interruption judgment
  - does not build final frame payloads

#### `FramePlanner`

- Classification: frame constructor
- Lives in [packages/core/src/frame-planner.ts](../packages/core/src/frame-planner.ts)
- Purpose: convert a chosen candidate into an `AttentionFrame`
- Boundary:
  - owns frame construction
  - does not rank competing interactions

#### `TaskViewStore`

- Classification: in-memory task-state store
- Lives in [packages/core/src/task-view-store.ts](../packages/core/src/task-view-store.ts)
- Purpose: maintain per-task `active`, `queued`, and `ambient` state

#### `buildAttentionView`

- Classification: aggregator
- Lives in [packages/core/src/attention-view.ts](../packages/core/src/attention-view.ts)
- Purpose: derive one `AttentionView` across many tasks

#### `AttentionSignalStore`

- Classification: signal memory
- Lives in [packages/core/src/attention-signal-store.ts](../packages/core/src/attention-signal-store.ts)
- Purpose: store signals and compute summaries

#### `AttentionAdjustments`

- Classification: lightweight scoring layer
- Lives in [packages/core/src/attention-adjustments.ts](../packages/core/src/attention-adjustments.ts)
- Purpose: apply small, source-agnostic score adjustments from signal history
- Boundary:
  - heuristic only
  - not model reasoning
  - not source-specific policy

### Adapter

Adapters are optional.

Use an adapter when:

- the upstream system has its own event vocabulary
- the upstream system needs a source-specific return path

Skip adapters when:

- you already control the event source
- you can emit `ApertureEvent` directly
- you want to consume `AttentionResponse` directly in your own app or service

#### `@aperture/codex`

- Classification: source adapter
- Lives in [packages/codex/src/index.ts](../packages/codex/src/index.ts)
- Purpose: translate Codex app-server approval and user-input requests into `SourceEvent`, translate `AttentionResponse` back into Codex response descriptors, and optionally publish through `@aperture/runtime`
- Owns:
  - Codex ingress mapping
  - Codex return-path mapping
- Does not own:
  - attention judgment
  - signal storage
  - direct Codex transport by itself

#### `@aperture/claude-code`

- Classification: source adapter
- Lives in:
  - [packages/claude-code/src/index.ts](../packages/claude-code/src/index.ts)
  - [packages/claude-code/src/server.ts](../packages/claude-code/src/server.ts)
- Purpose: translate Claude Code hook payloads into `SourceEvent`, translate `AttentionResponse` back into Claude Code hook responses, and optionally host a local HTTP hook endpoint that talks to `@aperture/runtime`
- Owns:
  - Claude Code ingress mapping
  - Claude Code return-path mapping
  - local hook transport
- Does not own:
  - attention judgment
  - signal storage
  - Claude Code session management

#### `@aperture/paperclip`

- Classification: source adapter
- Lives in [packages/paperclip/src/index.ts](../packages/paperclip/src/index.ts)
- Purpose: translate Paperclip live events into `SourceEvent` and translate `AttentionResponse` back into Paperclip actions, with optional publishing through `@aperture/runtime`
- Owns:
  - Paperclip ingress mapping
  - Paperclip return-path mapping
- Does not own:
  - attention judgment
  - signal storage
  - direct network transport by itself

### Attention Surface

#### `@aperture/tui`

- Classification: surface package
- Lives in [packages/tui/src/index.ts](../packages/tui/src/index.ts)
- Purpose: provide a persistent terminal-native attention surface above `@aperture/core` or the shared `@aperture/runtime`
- Owns:
  - full-screen terminal rendering
  - keyboard-driven `AttentionResponse` submission
- Does not own:
  - source-specific mapping
  - attention judgment
  - signal storage

## Boundary Summary

The shortest accurate model is:

`SourceEvent -> ApertureCore -> ApertureEvent -> AttentionFrame / AttentionView -> AttentionResponse`

Everything else is support structure around that loop.

## What Is The Product?

The product is:

- `@aperture/core`
- `@aperture/claude-code`
- `@aperture/paperclip`
- `@aperture/codex`
- `@aperture/tui`

The product is not:

- internal repo scripts
