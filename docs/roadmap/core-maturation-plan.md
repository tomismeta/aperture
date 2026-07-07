# Core Maturation Plan

This note captures the next engine-maturation ideas for Aperture's core.

Read this through the current engine source-of-truth frame:

- [Engine Status Pillars](../engine/engine-status-pillars.md)
- [Core Engine Audit (2026-03)](../engine/core-engine-audit-2026-03.md)

This document is still useful, but it is a maturation note, not the primary
status document for the engine.

Current status:

- explicit ambiguity handling is live in the bounded semantic lane and visible
  in traces / Lab evaluation
- attention surface capabilities are live as a conservative planning constraint
- markdown profile and policy readers intentionally accept only the current
  schema version and fall back to caller defaults for unknown future versions
- the highest-value next validation layer is harvested real-session replay, not
  broad core decomposition

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

Ambiguity and surface capability planning now have first implementation slices
in core. The remaining items should be treated as engine maturation ideas, not
urgent release blockers.

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

Status:

- live as a bounded first implementation
- semantic uncertainty can now keep non-blocking work in queue/ambient through the explicit ambiguity lane
- trace and Lab evaluation can now score ambiguity outcomes and recovery paths
- broader ambiguity handling still needs more surface-aware policy work
- harvested session replay is now the next best validation layer before larger
  structural refactors

Problem:

- Aperture now has an explicit first-class ambiguity path for bounded semantic uncertainty.
- The remaining problem is validating how that path behaves on messy real traffic
  and deciding whether more policy knobs are justified.

Proposal:

- define an explicit ambiguity policy
- make "not confident enough" a real intermediate decision state
- map that state to safe defaults

Examples:

- uncertain interrupt -> `next`
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

- Aperture now lets hosts declare attention surface capabilities and plans
  against the conservative intersection of core defaults and host constraints.
- As the SDK grows beyond the TUI, the remaining problem is richer
  surface-specific behavior without coupling core to any one UI.

Proposal:

- keep `surfaceCapabilities` as the public boundary
- expand only when real hosts need additional constraints

Examples:

- if the host does not support ambient presentation, do not rely on ambient as the main answer
- if the host only supports one active interruptive item, plan accordingly
- if the host cannot render forms, avoid form-heavy response paths when that
  constraint becomes first-class

Why this comes second:

- high leverage for multi-surface SDK adoption
- especially relevant for future custom UIs
- keeps the core loop unchanged while making the engine more realistic

Likely code areas:

- `packages/core/src/aperture-core.ts`
- `packages/core/src/attention-planner.ts`
- `packages/core/src/frame.ts`

Likely public surface impact:

- small if future work extends the existing `surfaceCapabilities` concept
- moderate only if hosts need a richer capability vocabulary

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

- `packages/core/src/policy-config.ts`
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

1. harvested replay for ambiguity and surface-capability behavior
2. first-class attention profiles if replay shows stable operator/host patterns
3. side-channel mode signals only after empirical pressure supports them

That order gives the best tradeoff between:

- engine maturity
- SDK stability
- implementation risk

## Why This Order Makes Sense

### Replay first

The first ambiguity and surface-capability slices are already live. Replay is the
best way to prove whether those choices stay predictable under messy source traffic.

### Profiles second

Profiles are more useful after replay shows which differences are stable product
needs rather than internal configuration names.

### Side signals third

These are powerful but easiest to get wrong. They should follow real host/integration evidence rather than precede it.

## Suggested Validation Questions

Before implementation, answer:

- what should the safe default be when the engine is unsure?
- what host constraints actually matter across TUI and future custom UIs?
- which profile differences are real product needs versus naming over internal config?
- which side-channel signals show up repeatedly in traces and operator behavior?

## Recommendation

Do not implement the remaining ideas all at once.

Treat them as a staged maturation path for the core engine, with harvested
session replay as the next disciplined step.
