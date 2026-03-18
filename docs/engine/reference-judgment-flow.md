# Reference Judgment Flow

This document is the smallest complete explanation of how Aperture makes a decision and how that decision becomes part of the learning loop.

It is intentionally narrower than the full architecture docs.

Use it when you want the atomic story of the engine.

## The Core Loop

Aperture does not just rank events.

It runs a compact judgment loop:

`event -> candidate -> policy -> value -> pressure -> planning -> attention frame -> human response -> signals -> memory -> next judgment`

That loop is the product.

## The Attention Judgment Layer

These are the major engine questions, in order:

1. **`EventEvaluator`** — what attention candidate does this event imply?
2. **`AttentionAdjustments`** — what bounded in-session nudges should apply from recent signal patterns?
3. **`EpisodeTracker`** — is this part of an existing decision episode?
4. **`AttentionPolicy`** — what is allowed?
5. **`AttentionValue`** — how valuable is human attention for this right now?
6. **`AttentionPressure`** — how much cognitive load is already building?
7. **`AttentionPlanner`** — where should this go: `activate`, `queue`, or `ambient`?
8. **`JudgmentCoordinator`** — compose the judgment into one inspectable decision
9. **`FramePlanner`** — materialize the chosen interaction into an `AttentionFrame`

In practice, those modules live inside [ApertureCore](../../packages/core/src/aperture-core.ts).

## One Decision, Step By Step

Imagine a new approval arrives from an agent.

### 1. Event -> Candidate

[EventEvaluator](../../packages/core/src/event-evaluator.ts) turns the raw event into an `AttentionCandidate`.

That candidate includes things like:

- `mode`
- `tone`
- `consequence`
- `priority`
- `blocking`
- `timestamp`

This is where source facts become Aperture semantics.

### 2. Candidate -> Attention Adjustments

[AttentionAdjustments](../../packages/core/src/attention-adjustments.ts) looks at recent task and global summaries and applies bounded score offsets and rationale.

This is still deterministic.

It does things like:

- quiet low-value status work when recent behavior suggests overload
- boost blocking work when similar interactions usually get quick responses
- nudge work that is often deferred and later resumed

These are in-session adjustments, not durable memory.

### 3. Candidate -> Episode

[EpisodeTracker](../../packages/core/src/episode-tracker.ts) decides whether this interaction belongs to an existing episode.

That lets Aperture treat related steps as one evolving decision instead of many isolated interrupts.

Examples:

- repeated failures on the same task
- a read/edit/bash chain on the same file
- a queued episode update that becomes actionable later

### 4. Policy

[AttentionPolicy](../../packages/core/src/attention-policy.ts) answers:

**what is allowed?**

It decides:

- `mayInterrupt`
- `requiresOperatorResponse`
- `minimumPresentation`

This is the hard-guardrail layer.

### 5. Value

[AttentionValue](../../packages/core/src/attention-value.ts) answers:

**how valuable is human attention for this interaction right now?**

It combines:

- priority
- consequence
- tone
- blocking
- bounded heuristic offsets
- durable source trust
- consequence calibration
- response affinity
- context cost
- deferral affinity

This is the main learned scoring layer.

### 6. Pressure

[AttentionPressure](../../packages/core/src/attention-pressure.ts) answers:

**how much attention is already being consumed or strained?**

It looks at:

- recent demand
- visible interruptive work
- response latency
- recent deferrals
- recent suppression

This is how Aperture starts anticipating overload instead of merely reacting to it.

### 7. Planning

[AttentionPlanner](../../packages/core/src/attention-planner.ts) answers:

**given policy, value, pressure, and queue state, what should happen now?**

It chooses among:

- `activate`
- `queue`
- `ambient`
- `keep`
- `clear`

This is where Aperture reasons over:

- the current active frame
- the visible queue
- burst suppression
- backlog suppression
- episode continuity
- actionable episodes
- overload handling

### 8. Coordination

[JudgmentCoordinator](../../packages/core/src/judgment-coordinator.ts) is the top-level judgment combiner.

It produces one inspectable explanation containing:

- policy verdict
- attention value breakdown
- attention pressure
- planner reasons
- current and candidate scores

### 9. Materialization

[FramePlanner](../../packages/core/src/frame-planner.ts) turns the chosen interaction into an `AttentionFrame`, and [TaskViewStore](../../packages/core/src/task-view-store.ts) updates task-local state.

From there, Aperture derives the cross-task `AttentionView` that surfaces see.

## The Self-Learning Loop

The judgment layer is only half of the story.

The second half is the learning loop.

### 1. Human behavior becomes signals

When the human:

- responds
- dismisses
- defers
- expands context
- ignores one frame while choosing another

Aperture records [AttentionSignal](../../packages/core/src/interaction-signal.ts) values through [AttentionSignalStore](../../packages/core/src/attention-signal-store.ts).

### 2. Signals produce summaries

The signal store derives recent summaries such as:

- response rate
- dismissal rate
- average response latency
- defer/return patterns

Those summaries already influence in-session judgment through:

- `AttentionAdjustments`
- `AttentionPressure`

### 3. Signals become durable memory

When Aperture checkpoints learned state, [distillMemoryProfile](../../packages/core/src/memory-aggregator.ts) distills signals into compact durable memory.

That memory currently includes:

- tool-family behavior
- source trust
- consequence profiles

The default runtime persists this into `.aperture/MEMORY.md`.

### 4. Next startup loads prior memory

On the next run, the runtime loads that learned memory back into [ApertureCore](../../packages/core/src/aperture-core.ts).

Now `AttentionValue` starts with prior knowledge about:

- which tool families usually resolve quickly
- which interactions often need more context
- which deferred interactions usually come back
- which sources and consequence bands are trustworthy

That is the durable learning flywheel.

## What Is Deterministic vs Learned

This distinction matters.

### Deterministic

- `EventEvaluator`
- `AttentionPolicy`
- `AttentionPlanner`
- `AttentionPressure`
- `FramePlanner`

### Learned or learning-informed

- `AttentionAdjustments`
- `AttentionValue`
- `EpisodeTracker`
- memory aggregation and calibration

The point is not to make the engine probabilistic.

The point is to let durable human behavior reshape a deterministic judgment system over time.

## Why This Matters

Any queue can sort by priority.

Aperture's wedge is that it:

- enforces policy
- estimates value
- reasons about pressure
- keeps episodes continuous
- learns from human behavior
- improves future judgments without putting a model in the hot path

That is the reference story of the engine.
