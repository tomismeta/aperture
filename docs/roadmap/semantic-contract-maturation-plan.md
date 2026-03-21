# Semantic Contract Maturation Plan

This document turns the recent Aperture Core audit, semantic interpretation
research sprint, and architecture review into one combined roadmap.

It exists to answer a simple question:

**What should Aperture build next if the goal is a deterministic semantic judgment engine that stays legible, benchmarkable, and future-flexible?**

## Why This Plan Exists

Aperture's core architecture is already strong in the places that matter most:

- deterministic routing
- policy / value / continuity separation
- a clean public SDK surface
- replay and benchmark infrastructure through Aperture Lab

The next maturity problem is not "rewrite the engine."

The next maturity problem is:

- the semantic layer is richer than the engine contract clearly admits
- determinism is strong in practice but not yet fully hardened structurally
- orchestration is still carrying some duplicated builder logic

This roadmap is designed to fix those issues in the right order.

## Core Thesis

The thing to protect is not today's heuristic implementation.

The thing to protect is:

- a stable semantic contract
- explicit precedence of source truth over inference
- deterministic downstream judgment over canonical semantics
- first-class abstention for uncertain semantics

If Aperture gets that right, the engine can evolve without losing the product
claim or painting itself into a corner.

## Branch Scope

This roadmap should live and evolve on:

- `codex/semantic-contract-maturation`

This branch should contain:

- semantic-contract docs and design decisions
- first implementation tranches for the contract and determinism work
- benchmark/test additions needed to lock the new contract

It does **not** need to contain every later engine-maturation idea in one giant
rollout.

The goal is to contain the semantic-contract tranche cleanly, then merge it once
the contract and first implementation slice are solid.

## What This Plan Combines

This roadmap pulls together three strands:

1. the core architecture audit
2. the semantic interpretation research sprint
3. the broader engine-maturation direction already captured in:
   - [Engine Roadmap](./engine-roadmap.md)
   - [Core Maturation Plan](./core-maturation-plan.md)

The relationship is:

- this plan is the **near-term prerequisite layer**
- it should happen before larger ambiguity, surface-capability, profile, and
  side-signal work expands further

## Value-Driven Priority

The order is driven by value, not by aesthetic refactoring.

### Highest value right now

1. semantic contract clarity
2. determinism hardening where it actually affects judgment
3. contract-locking tests
4. orchestration decomposition later

Why:

- a richer semantic system without a clear contract creates confusion and drift
- determinism matters most where replay and routing credibility are at stake
- decomposition before contract clarity only spreads ambiguity into more files

## Phase 0: Research And Framing

Status: `done on this branch`

Artifacts:

- [Semantic Interpretation Research Sprint](./semantic-interpretation-research.md)

What this phase adds:

- external grounding for bounded semantics, abstention, event relations, and
  attention management
- confidence that Aperture should keep:
  - deterministic judgment
  - narrow relation semantics
  - explicit source-truth precedence

This phase is complete enough to move into architecture decisions.

## Phase 1: Semantic Contract

Status: `next`

This is the highest-value phase.

### Problem

`SemanticInterpretation` currently carries fields that are not clearly divided
between:

- decision-bearing semantics
- explanation-only semantics
- confidence or abstention signals
- future-facing placeholders

The sharpest current gap is `task.updated`:

- core infers richer semantics
- but routing still mostly keys off `event.status`

### Goals

1. define a field taxonomy for `SemanticInterpretation`
2. decide the `task.updated` semantic contract explicitly
3. remove or demote semantic fields that imply routing behavior the engine does
   not actually honor

### Deliverables

- a semantic field taxonomy note
- a decision note for `task.updated`
- corresponding code changes in core types/interpreter/evaluator

Current decision artifacts:

- [Semantic Contract Decision](./semantic-contract-decision.md)

### Value

- removes architectural ambiguity
- makes the semantic layer easier to understand and evolve
- prevents accidental semantic sprawl

## Phase 2: Determinism Hardening

Status: `after contract decisions begin`

### Problem

Aperture is empirically deterministic under replay, but still contains time
seams in the hot path.

The most important one is in evidence resolution, where pressure and burden are
derived from wall-clock time.

### Goals

1. inject a `Clock` / `TimeSource` into judgment-relevant time calculations
2. start with evidence resolution
3. later extend the same abstraction to other core timestamps where replay
   semantics matter

### Deliverables

- `TimeSource` or equivalent in core
- deterministic evidence resolution under fixed time
- replay-safe tests for that seam

### Value

- strengthens the determinism claim materially
- makes Lab and replay more credible
- lowers hidden state drift risk

## Phase 3: Builder And Merge Cleanup

Status: `same tranche as Phase 2`

These are the low-risk cleanup wins.

### Problem

There are two real drift seams:

1. evidence-context shaping logic appears in multiple places
2. semantic/provenance merge behavior appears in multiple places

### Goals

1. centralize evidence-context building
2. centralize semantic `whyNow` / `factors` merge behavior

### Deliverables

- one shared evidence builder
- one shared semantic-provenance merge helper

### Value

- lowers maintenance cost
- prevents silent divergence
- makes future contract changes easier

## Phase 4: Contract-Locking Tests

Status: `after Phases 1-3 start landing`

### Goals

1. add `SourceEvent` vs equivalent `ApertureEvent` parity tests
2. add fixed-time determinism tests
3. add semantic influence tests

### Semantic influence tests should answer:

- which semantic fields affect routing?
- which fields only affect explanation?
- which fields are confidence/abstention inputs?

### Value

- converts architecture decisions into enforceable constraints
- keeps future refactors honest
- makes the semantic contract teachable to contributors

## Phase 5: Orchestration Decomposition

Status: `later`

### Problem

`ApertureCore` is carrying too many responsibilities for the long term.

That is real, but it is not the highest-value issue right now.

### Goal

After the contract and tests are settled, extract a cleaner publish/transition
kernel under the public `ApertureCore` shell.

### Likely future seam

- input validation
- evidence assembly
- evaluation
- coordination
- commit
- notifications

### Value

- long-term maintainability
- cleaner replay/simulation boundaries
- easier onboarding and evolution

## Relationship To Broader Engine Maturation

This plan should happen **before** or **alongside the earliest part** of the
broader maturation work in [Core Maturation Plan](./core-maturation-plan.md).

### Explicit ambiguity handling

This likely begins during or right after semantic contract work.

Reason:

- ambiguity handling depends on semantic confidence and abstention semantics

### Attention surface capabilities

This can proceed after the contract is clear.

Reason:

- surface-aware planning is valuable, but it does not solve the semantic
  contract ambiguity

### Profiles and side signals

These should come later.

Reason:

- they are more valuable once the semantic contract and determinism baseline are
  stable

## Recommended Execution Order

This is the combined recommended sequence:

1. semantic field taxonomy
2. `task.updated` contract decision
3. semantic-field removal or demotion for ambiguous non-routing fields
4. `TimeSource` in evidence resolution
5. shared evidence builder
6. shared semantic-provenance merge helper
7. parity and determinism tests
8. only then larger `ApertureCore` decomposition

## What Should Stay Stable

Do not disturb these unless the contract work proves a real need:

- the public root SDK surface
- the interpreter -> normalizer -> evaluator layering
- the policy / value / continuity split
- the narrow relation semantic set

## Anti-Patterns To Avoid

- expanding `SemanticInterpretation` before field taxonomy exists
- turning semantic inference into a second routing engine
- widening relation semantics too fast
- using confidence as a hidden score multiplier too early
- decomposing `ApertureCore` before the contract is settled

## Exit Criteria For This Branch

This branch should be considered ready to merge when it has:

1. a committed semantic contract decision
2. the first determinism hardening seam fixed
3. duplicated builder logic reduced
4. parity and determinism tests in place
5. no widening of the public SDK root surface

## Bottom Line

This branch is the right place to contain the next tranche.

It should hold:

- the semantic contract decisions
- the first determinism hardening work
- the contract-locking tests

It should not try to absorb every future engine idea at once.

The right move is:

- make semantics explicit
- make determinism stronger
- lock that in with tests
- then expand the engine from a cleaner base
