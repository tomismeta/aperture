# Aperture Engine Roadmap

## Purpose

This document defines where the engine is, where it is going, and why it is built the way it is.

The product only works if the engine becomes meaningfully better than application-level interrupt logic.

The moat lives in the core:

- deterministic judgment
- interaction signal capture
- human-shaped memory
- queue and episode planning
- anticipatory guidance

Not in:

- renderer code
- host integration glue
- protocol adapters

## Product Positioning

Aperture should be positioned as:

**the engine that learns how this human spends attention and protects it**

Not as:

- a notification center
- a generic priority queue
- an LLM wrapper around approval prompts

The wedge is not "AI decides what matters."

The wedge is:

**Aperture learns how this human spends attention and protects it faster, cheaper, and more transparently than a model in the hot path ever could.**

A model reasons from prompt context. Aperture reasons from system state. Prompt context is ephemeral and expensive. System state is durable, structured, and gets better with use.

## Current Status

As of `main` after the judgment stabilization milestone:

### Phase 1: Deterministic Router

Status: `complete`

What is built:

- event normalization into candidate interactions
- deterministic `activate / queue / ambient` coordination
- policy, utility, and planner separation
- queue-aware and consequence-aware planning
- source-agnostic task and attention views
- inspectable scoring and planner rationale

### Phase 2: Judgment Substrate

Status: `complete`

What is built:

- `policy -> utility -> planner` architecture
- pure Markdown `USER.md`, `MEMORY.md`, and `JUDGMENT.md`
- memory-backed adaptive utility scoring
- consequence calibration from human disagreement
- predictive pressure forecasting
- episode batching and merge heuristics
- runtime-safe hardening around markdown schema and task clearing

### Phase 3: Closed-Loop Adaptation

Status: `live, not yet mature`

What is built:

- interaction signals and derived summaries
- durable memory checkpointing and reload
- human-specific response, context, and deferral patterns feeding back into judgment
- replay evaluation foundation for merged episodes, deferred activation, and actionable episodes

What is still missing:

- evaluator-driven tuning loop ("what if we had deferred this by 90 seconds?")
- explicit stale episode lifecycle (state defined, not yet assigned)
- richer cross-session adaptation beyond summary carry-forward

### Phase 4: Anticipation

Status: `early foundation`

What is built:

- pressure forecasting before overload hits
- pre-overload suppression of lower-value work

What is still missing:

- "wait for correlated event before interrupting" behavior
- likely-next-context prefetching
- likely-next-action recommendations
- synthesized episode-level anticipation frames
- optional model-based advisory seam for speculative reasoning

### Phase 5: Multi-Agent Scale

Status: `multi-source arbitration started, scale not started`

What is built:

- multi-source normalization into one attention model
- cross-task and cross-source attention competition in the shared planner
- three adapter boundaries prepared (Claude Code live, Codex and Paperclip mapped)

What is still missing:

- live transports beyond Claude Code
- cross-source episode correlation
- distributed runtime
- performance characterization at scale

## The Moats

The current wedge is already visible in four areas.

### 1. Consequence Calibration

The engine learns when a source or adapter is wrong about risk.

That means "low risk" is not trusted forever just because the adapter said so.

This is hard to copy because it depends on closed-loop disagreement data over time, not static prompt instructions.

### 2. Operator Memory

The engine accumulates patterns like:

- which tool families get approved quickly
- which interactions usually need more context
- which work gets deferred and later resumed
- how this human behaves under pressure

This creates human-specific switching costs and makes the system better with use.

### 3. Episode Modeling

The engine treats related work as one evolving decision instead of many isolated interrupts.

Examples:

- `Read -> Edit -> Bash` on one file
- repeated failed status updates on the same task
- a queued episode update that later becomes actionable

This matches how humans actually reason about work.

### 4. The Closed Loop

The core loop is:

`signals -> memory -> utility -> planner -> presentation -> response -> new signals`

Any one step can be rebuilt.

The moat is the compounding effect of all of them together.

## Why The Judgment Layer Is Not An LLM Call

This is the most important strategic objection to answer clearly.

The hard problem is not making a plausible judgment. It is making a reliable judgment in the hot path.

A model can produce a plausible ranking. But the hot path needs all six of these simultaneously: fast, cheap, deterministic, inspectable, human-specific, and compounding over time. You rarely get all six from a model in the loop.

### 1. The Hot Path Must Be Fast

Tool approvals and interaction routing happen constantly.

The judgment core runs on arithmetic and in-memory state.

An LLM in the decision path would add seconds of latency to routine decisions and make the operator experience worse.

### 2. The Hot Path Must Be Cheap

The engine makes many small decisions.

Those decisions should have near-zero marginal cost.

A model-based judgment call on every event scales cost linearly with usage.

### 3. The Hot Path Must Be Deterministic

Some policies must be absolute:

- env writes require stronger presentation
- destructive bash requires approval
- explicit guardrails must never silently fail

Those are policy problems, not probabilistic reasoning problems.

### 4. The Hot Path Must Be Inspectable

Aperture can explain a judgment through:

- policy verdict
- utility components
- planner rationale
- trace replay

That kind of decomposition is much harder to maintain with a model making first-order routing decisions.

### 5. The Hot Path Must Learn Human-Specific Patterns

A general model can reason about risk in the abstract.

It does not naturally accumulate durable, human-specific behavioral memory unless the system around it already exists.

That surrounding system is exactly what Aperture is building.

### 6. A Model Reasons From Prompt Context. Aperture Reasons From System State.

Prompt context is ephemeral, expensive to construct, and discarded after each call. System state is durable, structured, and compounds with use. Aperture's memory profiles, episode history, and consequence calibration are system state that improves every session without re-prompting.

### The Right Role For Models

Models belong later, as an optional advisory layer on top of the deterministic substrate.

Good model-assisted tasks include:

- ambiguous episode merge suggestions
- context shaping
- likely-next-context recommendations
- "wait for correlated event" hints
- speculative anticipation

Models should not replace:

- hard policy
- hot-path routing
- deterministic planning
- safety-critical gating

## Engine Architecture

The engine now has four practical layers:

1. `Deterministic Coordination`
2. `Signal and Memory`
3. `Reasoning and Episodes`
4. `Anticipation`

Each layer should strengthen the same wedge:

**deciding how human attention should be spent**

### 1. Deterministic Coordination

Purpose:

- convert events into candidate interactions
- apply hard policy
- estimate utility
- plan presentation

Current constructs:

- `EvaluationEngine`
- `PolicyGates`
- `UtilityScore`
- `QueuePlanner`
- `FramePlanner`
- `TaskViewStore`
- `AttentionView`

### 2. Signal and Memory

Purpose:

- record how attention actually moved
- distill durable human patterns
- feed those patterns back into future judgment

Current constructs:

- `InteractionSignal`
- `InteractionSignalStore`
- `ProfileStore`
- `MemoryAggregator`
- `USER.md`
- `MEMORY.md`
- `JUDGMENT.md`

### 3. Reasoning and Episodes

Purpose:

- decide when many events are one decision
- keep related work continuous instead of fragmented
- calibrate trust and consequence over time

Current constructs:

- `EpisodeStore`
- consequence calibration in `UtilityScore`
- episode-aware planning and merge heuristics
- `TraceEvaluator`

### 4. Anticipation

Purpose:

- suppress low-value work before overload
- suggest when not to interrupt yet
- prepare likely next context

Current constructs:

- `PressureForecast`

Future constructs:

- evaluator-driven tuning loop
- optional reasoning advisor seam
- anticipation-specific planner hints

## What Makes Aperture Hard To Copy

Aperture becomes differentiated when it can do all of these together:

- normalize many event sources into one attention model
- adjudicate competing work deterministically
- learn from explicit and silent attention signals
- build durable human-specific memory
- reason in terms of episodes instead of alerts
- improve future decisions through replay and feedback
- add anticipation without surrendering policy control

Any single one of these can be replicated in isolation.

The combination — and the compounding effect of the closed loop connecting them — is the moat.

## Next Macro Steps

Ordered by impact:

1. **Evaluator-driven tuning** — replay traces to answer "what if we had deferred this?" and use the answer to refine judgment defaults.
2. **Episode expiry** — add stale-state transitions for abandoned episodes and time-based demotion.
3. **Deterministic low-risk pass-through** — let bounded low-risk tool families resolve without interrupting the human, which is likely the biggest remaining UX win.
4. **Anticipation behaviors** — add "wait for correlated event", likely-next-context, and pre-batching behavior.
5. **Advisory model seam** — add optional model reasoning for ambiguous episodes and speculative context, outside the hot path.
6. **Multi-source transport breadth** — add live Codex and Paperclip connections and stronger cross-source episode correlation.

## Recommendation

Treat the engine as the product.

Everything else should support it:

- adapters feed it
- hosts express it
- surfaces expose it

But the thing worth building and protecting is the engine that decides how human attention should be spent.
