# Architecture Principles

This document defines the current architectural rules for Aperture's hardening phase.

The goal is not to redesign the engine from scratch. The goal is to make the existing deterministic judgment stack more trustworthy by tightening boundaries, reducing routing-critical guesswork, and making decisions easier to replay and explain.

## Objective

The current hardening objective is:

- keep the live judgment path deterministic
- reduce heuristic meaning-making in routing-critical seams
- make adapter facts more explicit before policy and scoring run
- keep traces, tests, and state commit aligned with the actual decision path

## Core Principle

Adapters provide facts. Core provides judgment.

That means:

- source-specific semantics should enter through adapter-owned mapping code
- canonical normalization should happen in core
- policy, scoring, planning, continuity, and state commit should operate on stable engine concepts rather than source prose

## Principles

### 1. Keep live judgment deterministic

The hot path should stay:

- reproducible
- low-latency
- replayable
- traceable

Identical inputs should produce identical routing.

Current code paths:

- coordinator and final decision formation:
  - [packages/core/src/judgment-coordinator.ts](/Users/tom/dev/aperture/packages/core/src/judgment-coordinator.ts)
- routing and continuity:
  - [packages/core/src/attention-planner.ts](/Users/tom/dev/aperture/packages/core/src/attention-planner.ts)
- state commit:
  - [packages/core/src/task-view-store.ts](/Users/tom/dev/aperture/packages/core/src/task-view-store.ts)
- trace capture:
  - [packages/core/src/trace-recorder.ts](/Users/tom/dev/aperture/packages/core/src/trace-recorder.ts)
  - [packages/core/src/trace.ts](/Users/tom/dev/aperture/packages/core/src/trace.ts)

Implication:

- do not put stochastic model calls in the authoritative routing path
- keep replay and shadow evaluation offline

### 2. Semantics before judgment

Routing-critical meaning should come from structured facts before policy or scoring runs.

Adapters should provide explicit semantics when they know them. Core should normalize those facts into canonical event and candidate shapes.

Current code paths:

- adapter ingress:
  - [packages/claude-code/src/index.ts](/Users/tom/dev/aperture/packages/claude-code/src/index.ts)
  - [packages/opencode/src/mapping.ts](/Users/tom/dev/aperture/packages/opencode/src/mapping.ts)
  - [packages/codex/src/index.ts](/Users/tom/dev/aperture/packages/codex/src/index.ts)
- source event contract:
  - [packages/core/src/source-event.ts](/Users/tom/dev/aperture/packages/core/src/source-event.ts)
- canonical event contract:
  - [packages/core/src/events.ts](/Users/tom/dev/aperture/packages/core/src/events.ts)
- canonical normalization:
  - [packages/core/src/semantic-normalizer.ts](/Users/tom/dev/aperture/packages/core/src/semantic-normalizer.ts)
  - [packages/core/src/event-evaluator.ts](/Users/tom/dev/aperture/packages/core/src/event-evaluator.ts)
- explicit vs inferred taxonomy:
  - [packages/core/src/interaction-taxonomy.ts](/Users/tom/dev/aperture/packages/core/src/interaction-taxonomy.ts)

Implication:

- policy-critical code should prefer explicit semantics over inferred text matches
- heuristics can exist as fallback, but not as the primary source of truth for routing-critical decisions

### 3. Hard policy is separate from soft value

Guardrails, interrupt eligibility, and operator-owned rules must remain stricter than value scoring.

Policy answers:

- is this allowed to interrupt?
- is this required to stay peripheral?
- is operator response required?

Value answers:

- how much does this matter relative to other work?

Current code paths:

- policy:
  - [packages/core/src/attention-policy.ts](/Users/tom/dev/aperture/packages/core/src/attention-policy.ts)
  - [packages/core/src/policy](/Users/tom/dev/aperture/packages/core/src/policy)
- value:
  - [packages/core/src/attention-value.ts](/Users/tom/dev/aperture/packages/core/src/attention-value.ts)
  - [packages/core/src/frame-score.ts](/Users/tom/dev/aperture/packages/core/src/frame-score.ts)

Implication:

- hard policy should not be accidentally washed out by score drift
- configured/operator-owned rules should remain explicit and inspectable

### 4. Scoring must explain itself in named parts

Every material score contribution should have:

- a stable name
- a stable role
- a traceable rationale

Current code paths:

- candidate value decomposition:
  - [packages/core/src/attention-value.ts](/Users/tom/dev/aperture/packages/core/src/attention-value.ts)
- evidence-side adjustments:
  - [packages/core/src/attention-pressure.ts](/Users/tom/dev/aperture/packages/core/src/attention-pressure.ts)
  - [packages/core/src/attention-burden.ts](/Users/tom/dev/aperture/packages/core/src/attention-burden.ts)
  - [packages/core/src/attention-adjustments.ts](/Users/tom/dev/aperture/packages/core/src/attention-adjustments.ts)
- explanation output:
  - [packages/core/src/judgment-coordinator.ts](/Users/tom/dev/aperture/packages/core/src/judgment-coordinator.ts)
  - [packages/core/src/trace.ts](/Users/tom/dev/aperture/packages/core/src/trace.ts)

Implication:

- avoid anonymous score nudges in routing-critical paths
- prefer named components and explicit rationale strings

### 5. Planning is constraint-aware, not just ranking

Activation, queueing, ambient routing, and continuity should be treated as explicit tradeoffs under constraints, not as one flat sort.

Current code paths:

- planner:
  - [packages/core/src/attention-planner.ts](/Users/tom/dev/aperture/packages/core/src/attention-planner.ts)
- surface constraints:
  - [packages/core/src/surface-capabilities.ts](/Users/tom/dev/aperture/packages/core/src/surface-capabilities.ts)
  - [packages/core/src/aperture-core.ts](/Users/tom/dev/aperture/packages/core/src/aperture-core.ts)
- global attention ordering:
  - [packages/core/src/attention-view.ts](/Users/tom/dev/aperture/packages/core/src/attention-view.ts)

Implication:

- ranking matters, but ranking alone is not the decision
- routing should remain explicit about pressure, posture, current focus, and surface constraints

### 6. Continuity is a first-class decision

Protecting focus is part of correctness, not polish.

Current code paths:

- continuity rule set:
  - [packages/core/src/continuity](/Users/tom/dev/aperture/packages/core/src/continuity)
- continuity evaluation and ordering:
  - [packages/core/src/attention-planner.ts](/Users/tom/dev/aperture/packages/core/src/attention-planner.ts)

Implication:

- same interaction, same episode, minimum dwell, burst damping, and interrupt conflict should remain explicit and traceable
- continuity should not silently hide inside generic ranking logic

### 7. Optimize offline, not in the hot path

Search, tuning, replay comparison, and threshold refinement belong in offline workflows.

Current code paths:

- trace evaluation:
  - [packages/core/src/trace-evaluator.ts](/Users/tom/dev/aperture/packages/core/src/trace-evaluator.ts)
- signal aggregation and trend derivation:
  - [packages/core/src/signal-summary.ts](/Users/tom/dev/aperture/packages/core/src/signal-summary.ts)
  - [packages/core/src/attention-trends.ts](/Users/tom/dev/aperture/packages/core/src/attention-trends.ts)
  - [packages/core/src/memory-aggregator.ts](/Users/tom/dev/aperture/packages/core/src/memory-aggregator.ts)
- persisted profile and policy state:
  - [packages/core/src/profile-store.ts](/Users/tom/dev/aperture/packages/core/src/profile-store.ts)
  - [packages/core/src/markdown-state.ts](/Users/tom/dev/aperture/packages/core/src/markdown-state.ts)

Implication:

- the live engine should consume tuned parameters and learned summaries
- it should not run heavyweight search or stochastic optimization per event

### 8. Traceability is part of the product

Every routing decision should be reconstructable from:

- event inputs
- normalized semantics
- policy evaluations
- score components
- planner reasons
- continuity outcomes
- committed view state

Current code paths:

- explanation object:
  - [packages/core/src/judgment-coordinator.ts](/Users/tom/dev/aperture/packages/core/src/judgment-coordinator.ts)
- persisted trace:
  - [packages/core/src/trace.ts](/Users/tom/dev/aperture/packages/core/src/trace.ts)
  - [packages/core/src/trace-recorder.ts](/Users/tom/dev/aperture/packages/core/src/trace-recorder.ts)
- TUI why surface:
  - [packages/tui/src/render-why.ts](/Users/tom/dev/aperture/packages/tui/src/render-why.ts)

Implication:

- if a route cannot be explained with stable evidence, it is not mature enough to trust

### 9. Prefer Aperture-native structure over generic engines

Borrow ideas from solvers, planners, and rule engines, but keep the structure shaped around human attention control.

Current code paths:

- doctrine and architecture docs:
  - [docs/attention-judgment-doctrine.md](/Users/tom/dev/aperture/docs/attention-judgment-doctrine.md)
  - [docs/core-engine-architecture.md](/Users/tom/dev/aperture/docs/core-engine-architecture.md)
- Aperture-native judgment flow:
  - [packages/core/src/judgment-coordinator.ts](/Users/tom/dev/aperture/packages/core/src/judgment-coordinator.ts)
  - [packages/core/src/attention-policy.ts](/Users/tom/dev/aperture/packages/core/src/attention-policy.ts)
  - [packages/core/src/attention-planner.ts](/Users/tom/dev/aperture/packages/core/src/attention-planner.ts)

Implication:

- do not flatten the product into generic workflow automation concepts
- keep the architecture centered on interruption credibility, continuity, and attention surfaces

### 10. Add power by tightening boundaries

The engine should get smarter by making seams clearer, not blurrier.

The main boundaries are:

- adapter semantics vs core normalization
- hard policy vs soft value
- planning vs state commit
- learning vs live authority
- operator surface vs inspect/debug surface

Current code paths:

- normalization boundary:
  - [packages/core/src/source-event.ts](/Users/tom/dev/aperture/packages/core/src/source-event.ts)
  - [packages/core/src/events.ts](/Users/tom/dev/aperture/packages/core/src/events.ts)
  - [packages/core/src/semantic-normalizer.ts](/Users/tom/dev/aperture/packages/core/src/semantic-normalizer.ts)
- planning vs commit:
  - [packages/core/src/attention-planner.ts](/Users/tom/dev/aperture/packages/core/src/attention-planner.ts)
  - [packages/core/src/task-view-store.ts](/Users/tom/dev/aperture/packages/core/src/task-view-store.ts)
- learning vs authority:
  - [packages/core/src/profile-store.ts](/Users/tom/dev/aperture/packages/core/src/profile-store.ts)
  - [packages/core/src/memory-aggregator.ts](/Users/tom/dev/aperture/packages/core/src/memory-aggregator.ts)
  - [packages/core/src/attention-value.ts](/Users/tom/dev/aperture/packages/core/src/attention-value.ts)
- operator vs inspect surface:
  - [packages/tui/src/render.ts](/Users/tom/dev/aperture/packages/tui/src/render.ts)
  - [packages/tui/src/render-why.ts](/Users/tom/dev/aperture/packages/tui/src/render-why.ts)

Implication:

- new capability should usually sharpen a seam rather than cross it

## Bounded Fallbacks

Some heuristics still exist, but they should be treated as bounded compatibility fallbacks rather than primary truth.

Current bounded fallback rule:

- explicit status and explicit non-permission interaction classes use explicit tool semantics only
- generic approvals may still fall back to title/summary tool-family inference when the adapter cannot provide a better fact

Relevant files:

- [packages/core/src/interaction-taxonomy.ts](/Users/tom/dev/aperture/packages/core/src/interaction-taxonomy.ts)
- [packages/core/src/policy/configured-policy-support.ts](/Users/tom/dev/aperture/packages/core/src/policy/configured-policy-support.ts)
- [packages/core/src/attention-value.ts](/Users/tom/dev/aperture/packages/core/src/attention-value.ts)
- [packages/core/src/memory-aggregator.ts](/Users/tom/dev/aperture/packages/core/src/memory-aggregator.ts)

Implication:

- if a new path needs inference, it should be added deliberately and documented as bounded fallback
- inference should not silently expand into source-declared non-tool interactions

## Golden Scenarios

These are the current product invariants that should stay pinned:

- Claude read-tool completion stays ambient
  - [packages/claude-code/test/claude-code-server.test.ts](/Users/tom/dev/aperture/packages/claude-code/test/claude-code-server.test.ts)
- same-interaction status demotion leaves no lingering active frame
  - [packages/core/test/aperture-core.coordination.test.ts](/Users/tom/dev/aperture/packages/core/test/aperture-core.coordination.test.ts)
- passive status does not record inferred tool family from incidental wording
  - [packages/core/test/aperture-core.signals.test.ts](/Users/tom/dev/aperture/packages/core/test/aperture-core.signals.test.ts)
- explicit question requests do not enter low-risk read policy from title wording
  - [packages/core/test/judgment-layer.test.ts](/Users/tom/dev/aperture/packages/core/test/judgment-layer.test.ts)
- OpenCode question requests with read wording stay interactive under `lowRiskRead` auto-approve
  - [packages/opencode/test/opencode-runtime.test.ts](/Users/tom/dev/aperture/packages/opencode/test/opencode-runtime.test.ts)

## Hardening Checklist

Use this checklist when changing routing-critical behavior.

### Adapter changes

- is the adapter sending explicit semantics it already knows?
- are we preserving source-native facts without inventing judgment too early?
- are we relying on prose where structured metadata is available?

Relevant files:

- [packages/claude-code/src/index.ts](/Users/tom/dev/aperture/packages/claude-code/src/index.ts)
- [packages/opencode/src/mapping.ts](/Users/tom/dev/aperture/packages/opencode/src/mapping.ts)
- [packages/codex/src/index.ts](/Users/tom/dev/aperture/packages/codex/src/index.ts)

### Core normalization changes

- does canonical normalization prefer explicit semantics over inferred ones?
- are routing-critical fields distinguishable as explicit vs inferred?
- are we accidentally letting display text become policy?

Relevant files:

- [packages/core/src/semantic-normalizer.ts](/Users/tom/dev/aperture/packages/core/src/semantic-normalizer.ts)
- [packages/core/src/event-evaluator.ts](/Users/tom/dev/aperture/packages/core/src/event-evaluator.ts)
- [packages/core/src/interaction-taxonomy.ts](/Users/tom/dev/aperture/packages/core/src/interaction-taxonomy.ts)

### Policy / value / planner changes

- is this a hard-policy concern or a soft-value concern?
- does the planner treat the result as a constrained route instead of a flat rank?
- do continuity rules remain explicit and ordered intentionally?

Relevant files:

- [packages/core/src/attention-policy.ts](/Users/tom/dev/aperture/packages/core/src/attention-policy.ts)
- [packages/core/src/attention-value.ts](/Users/tom/dev/aperture/packages/core/src/attention-value.ts)
- [packages/core/src/attention-planner.ts](/Users/tom/dev/aperture/packages/core/src/attention-planner.ts)

### Commit / surface changes

- does committed task/global view state match the routed bucket?
- can the trace explain both the route and the surfaced result?
- are operator-facing summaries calmer than inspect/debug output?

Relevant files:

- [packages/core/src/task-view-store.ts](/Users/tom/dev/aperture/packages/core/src/task-view-store.ts)
- [packages/core/src/trace.ts](/Users/tom/dev/aperture/packages/core/src/trace.ts)
- [packages/tui/src/render.ts](/Users/tom/dev/aperture/packages/tui/src/render.ts)

## Bounded Fallbacks

Some heuristics still exist, but they should be treated as bounded compatibility fallbacks rather than primary truth.

Current bounded fallback rule:

- explicit status and explicit non-permission interaction classes use explicit tool semantics only
- generic approvals may still fall back to title/summary tool-family inference when the adapter cannot provide a better fact

Relevant files:

- [packages/core/src/interaction-taxonomy.ts](/Users/tom/dev/aperture/packages/core/src/interaction-taxonomy.ts)
- [packages/core/src/policy/configured-policy-support.ts](/Users/tom/dev/aperture/packages/core/src/policy/configured-policy-support.ts)
- [packages/core/src/attention-value.ts](/Users/tom/dev/aperture/packages/core/src/attention-value.ts)
- [packages/core/src/memory-aggregator.ts](/Users/tom/dev/aperture/packages/core/src/memory-aggregator.ts)

Implication:

- if a new path needs inference, it should be added deliberately and documented as bounded fallback
- inference should not silently expand into source-declared non-tool interactions

## Golden Scenarios

These are the current product invariants that should stay pinned:

- Claude read-tool completion stays ambient
  - [packages/claude-code/test/claude-code-server.test.ts](/Users/tom/dev/aperture/packages/claude-code/test/claude-code-server.test.ts)
- same-interaction status demotion leaves no lingering active frame
  - [packages/core/test/aperture-core.coordination.test.ts](/Users/tom/dev/aperture/packages/core/test/aperture-core.coordination.test.ts)
- passive status does not record inferred tool family from incidental wording
  - [packages/core/test/aperture-core.signals.test.ts](/Users/tom/dev/aperture/packages/core/test/aperture-core.signals.test.ts)
- explicit question requests do not enter low-risk read policy from title wording
  - [packages/core/test/judgment-layer.test.ts](/Users/tom/dev/aperture/packages/core/test/judgment-layer.test.ts)
- OpenCode question requests with read wording stay interactive under `lowRiskRead` auto-approve
  - [packages/opencode/test/opencode-runtime.test.ts](/Users/tom/dev/aperture/packages/opencode/test/opencode-runtime.test.ts)
- [packages/tui/src/render-why.ts](/Users/tom/dev/aperture/packages/tui/src/render-why.ts)

## Current Next Steps

The next hardening tranche should prioritize:

1. OpenCode explicit-semantics audit
2. stronger invariant coverage around passive status and route/commit agreement
3. continued reduction of policy-critical text inference
4. replay and scorecard tooling for judgment changes

See also:

- [Engine Architecture Evaluation](./engine-architecture-evaluation.md)
- [Semantic Normalization](./semantic-normalization.md)
- [Core Engine Architecture](./core-engine-architecture.md)
