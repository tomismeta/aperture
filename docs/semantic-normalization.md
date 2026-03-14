# Semantic Normalization

Aperture now uses an explicit layered event model:

`raw source payload -> SourceEvent -> ApertureEvent -> AttentionCandidate -> AttentionFrame -> AttentionResponse`

The intent is simple:

- keep adapters thin and factual
- keep core source-agnostic
- keep semantic policy consistent across adapters

## Layers

### Raw source payload

Raw upstream payloads owned by adapters only.

Examples:

- Claude Code hook JSON
- Paperclip live events
- Codex request objects

These never enter `@aperture/core` directly.

### `SourceEvent`

Source-agnostic factual input consumed by core.

Lives in [packages/core/src/source-event.ts](../packages/core/src/source-event.ts).

`SourceEvent` preserves:

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

Core converts `SourceEvent` into `ApertureEvent` through the internal semantic normalizer in [packages/core/src/semantic-normalizer.ts](../packages/core/src/semantic-normalizer.ts).

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
- shaping source input into `SourceEvent`
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

Integrations that emit `SourceEvent`s should pass them into:

- `core.publishSourceEvent(event)`

This keeps direct-core usage available while making adapter semantics more consistent.
