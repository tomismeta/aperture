# Components

This document describes the current Aperture component model after the slimming pass.

The intent is simple:

- keep the public product surface small
- keep internal engine pieces clear
- separate the engine from adapters and the companion surface

## Classification

### Core Product

These are part of Aperture itself.

#### `ApertureCore`

- Classification: runtime facade
- Lives in [packages/core/src/aperture-core.ts](../packages/core/src/aperture-core.ts)
- Purpose: the main engine entrypoint
- Owns:
  - semantic normalization of adapter inputs
  - ingesting `ApertureEvent`
  - ingesting `ConformedEvent`
  - producing `Frame`
  - producing `TaskView`
  - producing `AttentionView`
  - accepting `FrameResponse`
  - recording `InteractionSignal`
- Can be used directly:
  - with native `ApertureEvent`s
  - without any adapter package
- Does not own:
  - rendering
  - transport protocols
  - persistence beyond in-memory state

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

#### `ConformedEvent`

- Classification: adapter-to-core conformance contract
- Lives in [packages/core/src/conformed-event.ts](../packages/core/src/conformed-event.ts)
- Purpose: source-agnostic factual input produced by adapters before core applies semantic normalization
- Owns:
  - task and interaction identity
  - source identity
  - request payloads and context
  - factual hints like `riskHint`
- Does not own:
  - final Aperture `tone`
  - final Aperture `consequence`
  - attention judgment

#### `Frame`

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

#### `FrameResponse`

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

#### `TaskView`

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

#### `InteractionSignal`

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

#### `EvaluationEngine`

- Classification: semantic evaluator
- Lives in [packages/core/src/evaluation-engine.ts](../packages/core/src/evaluation-engine.ts)
- Purpose: convert semantically normalized `ApertureEvent` into candidate interactions
- Boundary:
  - decides what interaction a raw event implies
  - does not decide whether that interaction wins attention

#### `InteractionCoordinator`

- Classification: attention adjudicator
- Lives in [packages/core/src/interaction-coordinator.ts](../packages/core/src/interaction-coordinator.ts)
- Purpose: decide activate vs queue vs ambient vs keep
- Boundary:
  - owns interruption judgment
  - does not build final frame payloads

#### `FramePlanner`

- Classification: frame constructor
- Lives in [packages/core/src/frame-planner.ts](../packages/core/src/frame-planner.ts)
- Purpose: convert a chosen candidate into a `Frame`
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

#### `InteractionSignalStore`

- Classification: signal memory
- Lives in [packages/core/src/interaction-signal-store.ts](../packages/core/src/interaction-signal-store.ts)
- Purpose: store signals and compute summaries

#### `AttentionHeuristics`

- Classification: lightweight scoring layer
- Lives in [packages/core/src/attention-heuristics.ts](../packages/core/src/attention-heuristics.ts)
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
- you want to consume `FrameResponse` directly in your own app or service

#### `@aperture/codex`

- Classification: source adapter
- Lives in [packages/codex/src/index.ts](../packages/codex/src/index.ts)
- Purpose: translate Codex app-server approval and user-input requests into `ConformedEvent`, and translate `FrameResponse` back into Codex response descriptors
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
- Purpose: translate Claude Code hook payloads into `ConformedEvent`, translate `FrameResponse` back into Claude Code hook responses, and optionally host a local HTTP hook endpoint for Claude Code
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
- Purpose: translate Paperclip live events into `ConformedEvent` and translate `FrameResponse` back into Paperclip actions
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
- Purpose: provide a persistent terminal-native attention surface above `@aperture/core`
- Owns:
  - full-screen terminal rendering
  - keyboard-driven `FrameResponse` submission
- Does not own:
  - source-specific mapping
  - attention judgment
  - signal storage

## Boundary Summary

The shortest accurate model is:

`ConformedEvent -> ApertureCore -> ApertureEvent -> Frame / AttentionView -> FrameResponse`

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
