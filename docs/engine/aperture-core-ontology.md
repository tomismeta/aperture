# Aperture Core Ontology

For a simpler conceptual overview, see [Core Mental Model](./core-mental-model.md).

This document defines the canonical supervision ontology for Aperture Core.

It is intentionally small.

Its job is to give Aperture one stable language for:

- interpreting source activity
- reasoning about continuity
- deciding human attention routing
- evaluating whether that routing was correct

This is not a full schema dump and not a theory memo. It is the smallest useful
reference for the concepts that should stay stable across adapters, semantics,
judgment, traces, and calibration.

## Why This Exists

Aperture wants broad agent coverage without turning core into source-specific
logic.

That means:

- adapters should stay thin
- core should speak one canonical language
- replay and calibration should target that same language

If the ontology is clear, semantic breadth can grow by:

- adding better source facts
- improving interpretation quality
- expanding calibration coverage

without changing the core dialect every time a new host or workflow appears.

## What This Matures

This ontology improves Aperture Core in four ways:

### 1. Semantic breadth

New hosts and new agent behaviors can map into the same small set of core
dimensions instead of requiring custom routing rules per source.

### 2. Precision calibration

Every miss can be labeled against the same dimensions, which makes replay and
benchmark results easier to compare over time.

### 3. Boundary discipline

Adapters can provide explicit facts and hints, but core keeps ownership of the
canonical semantic read.

### 4. SDK durability

External consumers get one stable supervision model instead of a moving set of
host-shaped concepts.

## Canonical Dimensions

The current Aperture Core ontology should stay centered on seven dimensions.

### 1. `ask`

What kind of human-facing thing is this?

- `approval`
- `choice`
- `form`
- `status`
- `none`

This keeps the human-input shape stable across hosts.

### 2. `activity`

What is happening?

- `decision_request`
- `question`
- `task_progress`
- `task_completion`
- `failure`
- `background_work`

This keeps source-specific wording from leaking into core judgment.

### 3. `consequence`

How costly is it if this is handled badly?

- `low`
- `medium`
- `high`

This is a routing-relevant dimension, not just explanatory metadata.

### 4. `blocking`

Does forward progress actually depend on human attention?

- `blocking`
- `waiting`
- `non_blocking`

This is one of the most important source-agnostic supervision dimensions.

### 5. `episode`

How does this relate to ongoing work?

- `new`
- `same_issue`
- `resurfaced`
- `resolved`
- `unknown`

This lets Aperture reason across time instead of treating every event as
isolated.

### 6. `confidence`

How confident is Aperture in the current semantic read?

- `high`
- `medium`
- `low`

This is the simplest durable abstraction for abstention and ambiguity handling.
In practice, Aperture reads `confidence` together with `source` to decide how
strong the semantic evidence really is.

### 7. `source`

Where did the semantic read come from?

- `explicit`
- `hinted`
- `inferred`

This keeps provenance first-class and prevents inferred meaning from pretending
to be source fact.
`explicit` means the operative read came from the event shape or source-provided
fields, not only from Aperture's own wording inference.

## Routing Meaning

These dimensions matter because they are the stable supervision lens Aperture
calibrates against.

In simplified form:

- `ask`, `activity`, and `consequence` can shape canonical events and traceable
  judgment inputs
- `blocking` is the clean cross-source supervision dimension; status-event
  routing still keeps explicit task status authoritative, but clearly blocked
  waiting statuses can now stay queue-worthy without becoming full blocking
  interactions
- `episode` shapes continuity and resurfacing
- `confidence` and `source` combine into semantic evidence strength for
  ambiguity and trust handling

That means semantic breadth should be measured by how well Aperture can read
these dimensions across many sources, not by how many host-specific event kinds
it recognizes.

So, today, the ontology is best understood as:

- calibration-first
- trace-visible
- judgment-adjacent

Core also compiles it into a small internal judgment-input layer so policy and
planning can consume one cleaner semantic/evidence seam instead of reaching into
raw semantic fragments directly.

rather than as a fully first-class coordinator input on every path.

## Provenance Rule

Adapters may contribute:

- source-native facts
- bounded semantic hints
- source provenance

Core owns:

- the canonical semantic read
- continuity interpretation
- routing judgment
- trace projection
- calibration and replay expectations

This rule is what keeps Aperture source-agnostic.

## Calibration Families

To keep semantic improvement simple, misses should first be grouped into a
small set of families:

- `ask_missed`
- `ask_overread`
- `consequence_overread`
- `consequence_underread`
- `blocking_missed`
- `episode_missed`
- `confidence_too_high`
- `confidence_too_low`

These families are enough to start improving semantic breadth without inventing
an oversized taxonomy.

## What Not To Add Yet

Do not turn the ontology into a giant inventory of every possible attribute.

These concepts may matter later, but should not become first-class dimensions
yet:

- blast radius
- reversibility
- subagent lineage
- compaction state
- policy override cause
- doctrine source

Those can live in traces, explanations, or future refinements until there is a
clear cross-source need for promotion.

## Practical Standard

When adding new source coverage or new semantic logic, the first question
should be:

> Which ontology dimension is getting better?

If the answer is “none,” the change is probably adapter complexity, not core
maturation.

That is the standard that keeps Aperture broad, clean, and durable.
