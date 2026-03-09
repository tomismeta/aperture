# Aperture Engine Roadmap

## Purpose

This document defines the roadmap for Aperture's core engine itself.

The product only works if the engine becomes meaningfully better than application-level interrupt logic.

That means the moat must live in the core:

- deterministic judgment
- interaction signal capture
- reasoned attention decisions
- anticipatory guidance

Not in:

- renderer code
- host integration glue
- protocol adapters

## Core Principle

The engine should progress in four layers:

1. `Deterministic Engine`
2. `Signal Engine`
3. `Reasoning Engine`
4. `Anticipation Engine`

Each layer should strengthen the same wedge:

**deciding how human attention should be spent**

## Layer 1: Deterministic Engine

This is the foundation.

It should be policy-driven, testable, inspectable, and reliable.

### Current Constructs

- `EvaluationEngine`
- `InteractionCoordinator`
- `FramePlanner`
- `TaskViewStore`
- `AttentionView`

### Current Strengths

- deterministic tests for evaluation and coordination
- explicit blocking vs non-blocking handling
- source-agnostic task and attention views
- heuristic score adjustments informed by task-level signal history
- frame-level attention rationale persisted in metadata

### Current Responsibilities

- convert `ApertureEvent` into candidate interactions
- rank candidates against current interaction state
- decide activate vs queue vs ambient
- emit `Frame`
- derive `TaskView`
- derive `AttentionView`

### What Must Improve Next

- richer priority model than `background/normal/high`
- explicit suppression rules
- explicit replacement rules
- grouping rules for related interactions
- cross-source competition logic
- source-aware escalation
- bounded invariants and test coverage for all of the above

### Success Criteria

- deterministic outcomes are explainable
- the engine is predictable under concurrent events
- multiple sources can compete without the host inventing attention policy

## Layer 2: Signal Engine

This layer captures how attention was actually spent.

Without it, Aperture cannot learn, reason, or anticipate. It can only route.

### Current Constructs

- `InteractionSignal`
- `InteractionSignalStore`

### Current Strengths

- explicit signal capture for `presented`, `deferred`, `responded`, `dismissed`, and `context_expanded`
- sequence-aware signals for attention return and attention shift
- derived signal summaries for response rate, dismissal rate, latency, and deferral counts
- recency-bounded summaries so stale behavior does not dominate current judgment
- minimum-sample thresholds before stable behavioral states are inferred
- signal summaries already inform deterministic heuristics without coupling to source-specific logic

### Current Responsibilities

- record explicit response signals
- record presented signals
- record deferred signals
- preserve response latency

### Signals Aperture Should Eventually Capture

Explicit:

- `responded`
- `dismissed`

Temporal:

- time-to-present
- time-to-response
- time-to-dismiss
- time deferred before response

Structural:

- `context_expanded`
- section opened
- repeated provenance inspection

Comparative:

- which frame won attention first
- which queued frames were starved
- which ambient items remained untouched

Silent:

- frames never responded to
- repeated omissions
- suppressed frames that stayed irrelevant

### What Must Improve Next

- durable signal storage
- cross-surface signal normalization
- signal summaries per task, source, and operator
- scoring derived from raw signals
- operator-level attention heuristics on top of those summaries

### Success Criteria

- Aperture can describe not just what was shown, but how attention moved
- signals are usable by future reasoning without being tied to one host surface

## Layer 3: Reasoning Engine

This is where Aperture stops being only a policy router.

The reasoning layer interprets event context and interaction signals to improve judgment.

It should be advisory at first.

### Responsibilities

- decide whether two events are one decision or two
- decide whether an interruption should surface now or later
- decide how much context should be shown by default
- infer likely confusion, urgency, or confidence from interaction patterns
- recommend grouping, deferral, escalation, or suppression

### Inputs

- `ApertureEvent`
- current `TaskView`
- current `AttentionView`
- historical `InteractionSignal`

### Outputs

- suggested priority adjustments
- suggested grouping or merge decisions
- suggested context shaping
- rationale and confidence

### Guardrails

- deterministic policy still wins on high-consequence decisions
- reasoning must remain inspectable
- the engine must never silently hide important work without traceability

### Success Criteria

- the engine makes better decisions than a static ruleset
- developers can still understand why it made them

## Layer 4: Anticipation Engine

This layer helps the system prepare before the human asks.

It should not be framed as autonomous decision-making.

It is guidance.

### Responsibilities

- predict likely next human questions
- predict likely next actions
- suggest context to gather in advance
- pre-stage likely next frames
- recommend likely next best interactions to the coordinator
- suggest when not to interrupt yet

### Inputs

- historical `InteractionSignal`
- current `AttentionView`
- current source/task state
- reasoning outputs

### Outputs

- anticipation hints
- prefetch recommendations
- precomputed options
- suggested next-frame candidates
- operator-specific or workflow-specific timing hints

### Guardrails

- no silent auto-action for consequential workflows
- suggestions remain inspectable
- anticipation must be easy to disable

### Success Criteria

- less latency between need and context
- fewer unnecessary interruptions
- smoother operator flow without losing control

## Engine Build Sequence

The practical implementation order should be:

1. harden deterministic coordination
2. expand and persist interaction signals
3. derive signal summaries and heuristics
4. add advisory reasoning outputs
5. add advisory anticipation outputs

This is the order in which the engine becomes difficult to copy.

## What Makes The Engine Hard To Copy

The engine becomes differentiated when it can do all of these together:

- normalize many event sources into one attention model
- adjudicate multiple competing interactions deterministically
- learn from explicit and silent attention signals
- improve future attention decisions through reasoning
- prepare future interactions through anticipation

Any one of these alone can be rebuilt.

The combination is the moat.

## Near-Term Priorities

The next engine milestones should be:

1. strengthen `InteractionCoordinator` rules
2. add durable signal storage and signal summaries
3. add source-aware and consequence-aware heuristics
4. expose attention-decision rationale in core outputs

Only after those should Aperture invest heavily in:

- model-assisted reasoning
- anticipation
- broader surface support

## Recommendation

Treat the engine as the product.

Everything else should support it:

- adapters feed it
- hosts express it
- surfaces expose it

But the thing worth building and protecting is the engine that decides how human attention should be spent.
