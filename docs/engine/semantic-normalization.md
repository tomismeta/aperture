# Semantic Normalization

Aperture now uses an explicit layered event model:

`raw source payload -> SourceEvent -> SemanticInterpretation -> ApertureEvent -> AttentionCandidate -> AttentionFrame -> AttentionResponse`

The intent is simple:

- keep adapters thin and factual
- keep core source-agnostic
- make semantic interpretation explicit and inspectable
- keep semantic policy consistent across adapters
- make explicit semantics primary and heuristics bounded

## Layers

### Raw source payload

Raw upstream payloads owned by adapters only.

Examples:

- Claude Code hook JSON
- OpenCode server events
- Codex request objects

These never enter `@tomismeta/aperture-core` directly.

### `SourceEvent`

Source-agnostic factual input consumed by core.

Lives in [packages/core/src/source-event.ts](../../packages/core/src/source-event.ts).

`SourceEvent` preserves:

- task identity
- interaction identity
- source identity
- title and summary
- request payloads
- context and provenance
- optional factual hints like `riskHint`
- explicit semantic fields when adapters know them, such as:
  - `toolFamily`
  - `activityClass`
- optional semantic overrides through `semanticHints`

It does **not** assign final Aperture semantics like:

- `tone`
- final `consequence`
- attention priority

### `SemanticInterpretation`

Structured semantic facts inferred or supplied before canonical normalization.

Lives in:

- [packages/core/src/semantic-types.ts](../../packages/core/src/semantic-types.ts)
- [packages/core/src/semantic-interpreter.ts](../../packages/core/src/semantic-interpreter.ts)

This layer is:

- deterministic
- dependency-free
- bounded to routing-relevant semantics
- explicit about confidence, factors, reasons, and `whyNow`

It can capture things like:

- intent frame
- operator action requirement
- request explicitness
- consequence hint
- tool family
- explanation-friendly reasons

Adapters can override or supplement inference through `SourceEvent.semanticHints`.

Core merges those explicit hints over built-in inference before producing canonical `ApertureEvent`s.

### `ApertureEvent`

Semantically normalized engine event owned by core.

Lives in [packages/core/src/events.ts](../../packages/core/src/events.ts).

Core converts `SourceEvent` into `ApertureEvent` through the internal semantic normalizer in [packages/core/src/semantic-normalizer.ts](../../packages/core/src/semantic-normalizer.ts).

That normalizer now consumes both:

- the factual `SourceEvent`
- the bounded `SemanticInterpretation`

This is where Aperture decides things like:

- a high-risk approval becomes `critical` / `high`
- a medium-risk approval becomes `focused` / `medium`

This is also where the adapter/core boundary matters most:

- adapters should provide facts
- core should provide bounded semantic interpretation, canonical semantics, and judgment
- loose text inference should remain bounded fallback, not the primary source of meaning

### Attention engine

After normalization, the existing engine applies:

- evaluation
- heuristics
- coordination
- frame planning

In the current hardened design:

- policy-critical paths prefer explicit adapter facts and explicit semantic hints
- built-in semantic inference remains bounded and deterministic
- downstream judgment runs on canonical structures, not raw prose

## Responsibilities

### Adapters own

- source-native payload parsing
- source identity and ID preservation
- shaping source input into `SourceEvent`
- response mapping back to the source
- transport, if needed

### Core owns

- bounded semantic interpretation
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

Direct users can also call the semantic layer explicitly through:

- `interpretSourceEvent(event)`

That is useful when you want to inspect or test core's semantic reading before publishing the event into the full judgment loop.
