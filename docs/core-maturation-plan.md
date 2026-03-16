# Core Maturation Plan

This note captures the next engine-maturation ideas for Aperture's core.

Some of these ideas were sharpened by looking at ClawRouter, an open-source model routing system, but the framing and roadmap here are Aperture's own.

The goal is not to copy another system's literal routing logic.

The goal is to borrow the parts of its decision architecture that can strengthen
Aperture's judgment model while keeping Aperture focused on human attention rather
than model selection.

## Summary

The strongest transferable ideas are:

1. explicit ambiguity handling
2. attention-surface-aware planning
3. first-class attention profiles
4. mode-shaping side signals

These should be treated as engine maturation ideas, not urgent release blockers.

## What We Are Not Copying

We should not copy:

- keyword-heavy scoring as the primary engine
- discrete complexity tiers as Aperture's main mental model
- LLM fallback classification as the default next step

ClawRouter is solving model routing. Aperture is solving human attention judgment.

The useful transfer is in the structure of the decision process, not the exact scoring mechanics.

## Priority Order

### Priority 1: Explicit ambiguity handling

This is the highest-value idea.

Problem:

- Aperture currently makes interrupt / queue / ambient decisions, but uncertainty is not yet a fully explicit first-class outcome.
- That means low-confidence cases can blur into ordinary scoring behavior.

Proposal:

- define an explicit ambiguity policy
- make "not confident enough" a real intermediate decision state
- map that state to safe defaults

Examples:

- uncertain interrupt -> `queued`
- uncertain suppression -> `ambient`
- uncertain human-decision path -> explicit review

Why this comes first:

- high leverage
- low surface-area cost
- improves safety
- improves predictability for integrations beyond the terminal

Likely code areas:

- `packages/core/src/judgment-coordinator.ts`
- `packages/core/src/attention-planner.ts`
- `packages/core/src/trace-evaluator.ts`

Likely public surface impact:

- small
- maybe one config concept for ambiguity defaults
- maybe richer explanations / traces

### Priority 2: Attention-surface-aware planning

This is the most important integration-driven idea.

Problem:

- Aperture currently plans attention state without a strongly explicit model of what the attention surface can actually render or accept.
- As the SDK grows beyond the TUI, this becomes more important.

Proposal:

- let the attention surface declare its capabilities
- make the planner respect those constraints

Examples:

- if the host does not support ambient presentation, do not rely on ambient as the main answer
- if the host only supports one active interruptive item, plan accordingly
- if the host cannot render forms, avoid form-heavy response paths

Why this comes second:

- high leverage for multi-surface SDK adoption
- especially relevant for future custom UIs
- keeps the core loop unchanged while making the engine more realistic

Likely code areas:

- `packages/core/src/aperture-core.ts`
- `packages/core/src/attention-planner.ts`
- `packages/core/src/frame.ts`

Likely public surface impact:

- moderate
- one new config concept such as `surfaceCapabilities`

### Priority 3: First-class attention profiles

This is a strong usability and productization improvement.

Problem:

- hosts and operators may want distinct attention styles, but the engine currently has one main behavioral shape plus config details

Proposal:

- introduce named attention profiles

Examples:

- `balanced`
- `conservative`
- `interrupt-minimizing`
- `review-heavy`

Profiles would tune:

- planner defaults
- promotion thresholds
- presentation floor
- maybe some policy strictness

Why this comes third:

- useful, but less urgent than ambiguity and host constraints
- best added after the lower-level confidence and capability model is clearer

Likely code areas:

- `packages/core/src/judgment-config.ts`
- `packages/core/src/judgment-defaults.ts`
- `packages/core/src/attention-planner.ts`

Likely public surface impact:

- moderate
- one new config type and profile vocabulary

### Priority 4: Mode-shaping side signals

This is the most subtle idea and should come last.

Problem:

- some factors should influence mode or presentation without dominating the full judgment score

Proposal:

- introduce explicit side-channel signals that affect planning mode

Examples:

- human commitment cost
- workflow continuity risk
- operator context cost

These should:

- shape planning and presentation
- not become a second giant score that makes the engine harder to reason about

Why this comes fourth:

- easy to overcomplicate
- best informed by real integrations and traces
- likely to benefit from more empirical grounding first

Likely code areas:

- `packages/core/src/attention-value.ts`
- `packages/core/src/judgment-coordinator.ts`
- `packages/core/src/attention-planner.ts`

Likely public surface impact:

- ideally very small
- mostly trace / explanation enrichment

## Recommended Order Of Work

If we pursue these ideas, the order should be:

1. ambiguity handling
2. attention surface capability config
3. attention profiles
4. side-channel mode signals

That order gives the best tradeoff between:

- engine maturity
- SDK stability
- implementation risk

## Why This Order Makes Sense

### Ambiguity first

This improves the engine's decision safety immediately without forcing much surface change.

### Attention surface capabilities second

This makes the SDK more honest for multiple host surfaces and supports real integrations.

### Profiles third

Profiles are more useful after the engine already knows how to behave under uncertainty and under host constraints.

### Side signals fourth

These are powerful but easiest to get wrong. They should follow real host/integration evidence rather than precede it.

## Suggested Validation Questions

Before implementation, answer:

- what should the safe default be when the engine is unsure?
- what host constraints actually matter across TUI and future custom UIs?
- which profile differences are real product needs versus naming over internal config?
- which side-channel signals show up repeatedly in traces and operator behavior?

## Recommendation

Do not implement these all at once.

Treat them as a staged maturation path for the core engine.

If one idea is chosen first, it should be explicit ambiguity handling.
