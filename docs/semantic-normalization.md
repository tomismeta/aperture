# Semantic Normalization

Aperture now uses an explicit layered event model:

`SourceEvent -> AdapterEvent -> ApertureEvent -> AttentionCandidate -> AttentionFrame -> AttentionResponse`

The intent is simple:

- keep adapters thin and factual
- keep core source-agnostic
- keep semantic policy consistent across adapters

## Layers

### `SourceEvent`

Raw upstream payloads owned by adapters only.

Examples:

- Claude Code hook JSON
- Paperclip live events
- Codex request objects

These never enter `@aperture/core`.

### `AdapterEvent`

Source-agnostic factual input produced by adapters and consumed by core.

Lives in [packages/core/src/adapter-event.ts](../packages/core/src/adapter-event.ts).

`AdapterEvent` preserves:

- task identity
- interaction identity
- source identity
- title and summary
- request payloads
- context and provenance
- optional factual hints like `riskHint`

It does **not** assign final Aperture semantics like:

- `tone`
- final `consequence`
- attention priority

### `ApertureEvent`

Semantically normalized engine event owned by core.

Lives in [packages/core/src/events.ts](../packages/core/src/events.ts).

Core converts `AdapterEvent` into `ApertureEvent` through the internal semantic normalizer in [packages/core/src/semantic-normalizer.ts](../packages/core/src/semantic-normalizer.ts).

This is where Aperture decides things like:

- a high-risk approval becomes `critical` / `high`
- a medium-risk approval becomes `focused` / `medium`

### Attention engine

After normalization, the existing engine applies:

- evaluation
- heuristics
- coordination
- frame planning

## Responsibilities

### Adapters own

- source-native payload parsing
- source identity and ID preservation
- adapter shaping into `AdapterEvent`
- response mapping back to the source
- transport, if needed

### Core owns

- semantic normalization
- attention state and trends
- scoring and heuristics
- active / queued / ambient decisions
- frame construction

## Public API

Direct users can still publish native `ApertureEvent`s into `ApertureCore`.

Adapters now emit `AdapterEvent`s and should be passed into:

- `core.publishAdapterEvent(event)`

This keeps direct-core usage available while making adapter semantics more consistent.
