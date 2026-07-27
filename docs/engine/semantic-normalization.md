# Semantic Normalization

Aperture now uses an explicit layered event model:

`raw source payload -> SourceEvent -> EnrichedApertureEvent -> semantic evidence -> AttentionJudgmentInput -> AttentionCandidate -> AttentionFrame -> AttentionResponse`

The intent is simple:

- keep adapters thin and factual
- keep core source-agnostic
- keep semantic policy consistent across adapters
- make explicit semantics primary and heuristics bounded

## Layers

### Raw source payload

Raw upstream payloads owned by adapters only.

Examples:

- Claude Code hook JSON
- OpenCode server events
- Codex request objects
- Pi extension events

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

It does **not** assign final Aperture semantics like:

- `tone`
- final `consequence`
- attention priority

### `ApertureEvent`

Semantically normalized engine event owned by core.

Lives in [packages/core/src/events.ts](../../packages/core/src/events.ts).

Core converts `SourceEvent` into `ApertureEvent` through the internal semantic normalizer in [packages/core/src/semantic-normalizer.ts](../../packages/core/src/semantic-normalizer.ts).

This is where Aperture decides things like:

- a high-risk approval becomes `critical` / `high`
- a medium-risk approval becomes `focused` / `medium`

### `AttentionJudgmentInput`

Internal semantic-to-judgment seam owned by core.

Lives in [packages/core/src/judgment-input.ts](../../packages/core/src/judgment-input.ts).

Before this seam, core performs a private semantic-evidence read in
[packages/core/src/semantic-evidence.ts](../../packages/core/src/semantic-evidence.ts).
That classifier is deliberately not part of the public semantic API. It reads
engine-owned event facts such as status, title, summary, explicit tool family,
and context. It does not trust adapter-supplied `factors`, `reasons`, or audit
metadata as evidence.

This is where core compiles:

- ontology projection
- semantic evidence strength from `confidence + source`
- blocked-like status diagnostics
- routine observational status-conflict diagnostics

into one small object that policy, ambiguity handling, planning, and trace can
all consume consistently.

Current contract nuance:

- `human.input.requested` semantics can project into canonical event consequence
  and provenance before routing
- `task.updated` semantics enrich continuity, provenance, `toolFamily`, and
  `activityClass`
- `task.updated.status` remains authoritative for status routing except when
  engine-owned routine observational evidence contradicts a noisy failed status
- semantic hints may veto that exception by lowering confidence, abstaining, or
  changing the final semantic shape; they may not create the raw evidence
- operator-directed status asks can stay low-confidence and `source: inferred`
  without pretending to be explicit request events

This is also where the adapter/core boundary matters most:

- adapters should provide facts
- core should provide canonical semantics and judgment
- loose text inference should remain bounded fallback, not the primary source of meaning

### Attention engine

After normalization, the existing engine applies:

- judgment-input compilation
- evaluation
- heuristics
- coordination
- frame planning

In the current hardened design:

- policy-critical paths prefer explicit semantics
- bounded heuristics are still allowed where the source truly omits structure
- generic approval paths are the main remaining place where bounded tool-family inference may apply
- confidence and abstention are recorded semantic signals
- they are not hidden score multipliers
- low-confidence or abstained non-blocking work can resolve to queue/ambient through the engine's explicit ambiguity lane

## Responsibilities

### Adapters own

- source-native payload parsing
- source identity and ID preservation
- shaping source input into `SourceEvent`
- response mapping back to the source
- transport, if needed

### Core owns

- semantic normalization
- judgment-input compilation
- attention state and trends
- scoring and heuristics
- now / next / ambient decisions
- frame construction

## Public API

Direct users can still publish native `ApertureEvent`s into `ApertureCore`.

Integrations that emit `SourceEvent`s should pass them into:

- `core.publishSourceEvent(event)`

This keeps direct-core usage available while making adapter semantics more consistent.

For advanced readers, the actual current hot path is:

`SourceEvent/ApertureEvent -> finalized event (usually EnrichedApertureEvent) -> semantic evidence -> AttentionJudgmentInput -> AttentionCandidate -> judgment -> AttentionFrame/AttentionView + trace`
