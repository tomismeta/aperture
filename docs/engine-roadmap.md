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

**the human attention control plane for agent systems**

More specifically:

**the engine that learns how this human spends attention and protects it**

Not as:

- a notification center
- a generic priority queue
- an LLM wrapper around approval prompts

The wedge is not "AI decides what matters."

The wedge is:

**Aperture learns how this human spends attention and protects it faster, cheaper, and more transparently than a model in the hot path ever could.**

A model reasons from prompt context. Aperture reasons from system state. Prompt context is ephemeral and expensive. System state is durable, structured, and gets better with use.

Over time, Aperture should be able to exist in two complementary forms:

- as a product runtime and surface for humans supervising agents
- as an embeddable judgment SDK other agent runtimes can adopt directly

## Current Status

As of `main`, Aperture has moved past the "can this route interrupts?" stage.

The product arc now looks like this:

### 1. Filter

Status: `built`

Aperture can already decide:

- what should interrupt now
- what should wait in the queue
- what should remain ambient

This includes:

- event normalization into candidate interactions
- deterministic `activate / queue / ambient` coordination
- source-agnostic task and attention views
- inspectable policy, value, and planner rationale

### 2. Learn

Status: `built, not yet mature`

Aperture can already improve from use:

- interaction signals and derived summaries
- durable learning persistence through `.aperture/MEMORY.md`
- local judgment control through scaffolded `.aperture/JUDGMENT.md`
- bounded deterministic auto-approval for explicitly configured safe categories
- consequence calibration from human disagreement
- human-specific response, context, and deferral patterns feeding back into judgment

What is still missing:

- evaluator-driven tuning from replay evidence
- richer cross-session adaptation beyond summary carry-forward
- explicit migration paths for persisted schema changes

### 3. Orchestrate

Status: `underway`

Aperture no longer treats work as a flat queue. It can already:

- separate hard policy from adaptive value and planning
- group related work into episodes
- batch status bursts
- merge related updates
- keep queue behavior aware of consequence and pressure

What is still missing:

- explicit stale episode lifecycle
- stronger cross-task episode continuity
- more episode-aware presentation shaping

### 4. Anticipate

Status: `early foundation`

Aperture has begun to prepare attention before overload:

- predictive attention pressure
- pre-overload suppression of lower-value work

What is still missing:

- "wait for correlated event before interrupting" behavior
- likely-next-context preparation
- likely-next-action recommendations
- synthesized episode-level anticipation frames
- optional model-based advisory seam for speculative reasoning

### 5. Compound

Status: `emerging`

This is the moat-deepening phase: the point where Aperture becomes meaningfully better because it has history.

The foundation is already present:

- closed-loop signals → memory → judgment → response
- replay evaluation foundation
- durable learned state

What is still missing:

- replay-driven threshold refinement
- stronger evidence-based planner tuning
- broader consequence and source calibration over time

### 6. Embed

Status: `planned`

The long-term shape is still two complementary forms:

- a product runtime and surface for humans supervising agents
- an embeddable judgment SDK other runtimes can adopt

What is already true:

- the core judgment stack is real and exported
- multi-source normalization already exists
- Claude Code is the live end-to-end path
- Codex and Paperclip boundaries are prepared

What is still missing:

- live transports beyond Claude Code
- stable external package contracts
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

- `EventEvaluator`
- `AttentionPolicy`
- `AttentionValue`
- `AttentionPlanner`
- `FramePlanner`
- `TaskViewStore`
- `AttentionView`

### 2. Signal and Memory

Purpose:

- record how attention actually moved
- distill durable human patterns
- feed those patterns back into future judgment

Current constructs:

- `AttentionSignal`
- `AttentionSignalStore`
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

- `EpisodeTracker`
- consequence calibration in `AttentionValue`
- episode-aware planning and merge heuristics
- `TraceEvaluator`

### 4. Anticipation

Purpose:

- suppress low-value work before overload
- suggest when not to interrupt yet
- prepare likely next context

Current constructs:

- `AttentionPressure`

Future constructs:

- evaluator-driven tuning loop
- optional reasoning advisor seam
- anticipation-specific planner hints

## SDK Path

The long-term package story should follow the same wedge.

The goal is not to turn Aperture into a generic orchestration framework. The goal is to make the judgment substrate portable.

That means a future `@aperture/core` should expose:

- the full deterministic judgment stack (`AttentionPolicy`, `AttentionValue`, `AttentionPlanner`, `JudgmentCoordinator`)
- the memory loop (`AttentionSignalStore`, memory aggregation, profile persistence)
- the full-engine path (`ApertureCore`) for hosts that want the whole attention model

This would let another agent runtime keep its own orchestration model while delegating human-attention judgment to Aperture.

The package path matters because it broadens distribution, but it should come after the product path stays stable. The priority is still proving the engine in the live runtime first.

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

1. **Move from learning to compounding** — use replay evidence to refine planner behavior and judgment defaults from real sessions instead of intuition.
2. **Complete orchestration** — give episodes a full lifecycle, including stale-state transitions and graceful fading for abandoned work.
3. **Deepen anticipation** — move from pressure sensing into better timing: wait for correlated events, prepare likely context, and shape stronger decision frames.
4. **Expand bounded pass-through** — let more clearly safe categories resolve deterministically without interrupting the human, while keeping guardrails explicit and inspectable.
5. **Add an advisory reasoning seam** — introduce optional model assistance for ambiguous, speculative work outside the hot path.
6. **Broaden the live runtime surface** — add transport breadth beyond Claude Code and strengthen cross-source episode handling.
7. **Prove the substrate can travel** — harden `@aperture/core` into a stable embeddable judgment package once the live product path has settled.

## Recommendation

Treat the engine as the product.

Everything else should support it:

- adapters feed it
- hosts express it
- surfaces expose it

But the thing worth building and protecting is the engine that decides how human attention should be spent.
