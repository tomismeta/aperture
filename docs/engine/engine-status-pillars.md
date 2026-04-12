# Engine Status Pillars

This note defines six compact pillars for talking about Aperture's engine status
and roadmap.

Use this when you want a code-grounded status frame instead of the full doctrine
catalog.

These pillars are intentionally derived from the current implementation, not
just from philosophy.

## Why This Exists

The doctrine docs are useful, but they are broader than the day-to-day status
and roadmap conversation needs.

For communication, Aperture should have a smaller frame that answers:

- what is strong now?
- what is still maturing?
- what should come next?

## Current Rollup (2026-04)

As of 2026-04-11, Aperture reads like a strong early-stage infrastructure
codebase rather than a fragile prototype.

The strongest parts are:

- product thesis and timing
- package boundaries and runtime contract discipline
- testing and release-gate seriousness

The main gaps are now more operational than conceptual:

- listener isolation and delivery safety
- long-run retention and lifecycle pruning
- richer runtime observability
- durability semantics for state that must outlive a local session

The practical summary is:

- **overall: B+**
- **not rewrite territory**
- **closest path to A- is boring hardening, not strategy change**

## The Six Pillars

### 1. Structured Semantics

Question:

- do source facts become stable Aperture meaning before judgment runs?

Current code anchors:

- `packages/core/src/source-event.ts`
- `packages/core/src/events.ts`
- `packages/core/src/semantic-normalizer.ts`
- `packages/core/src/event-evaluator.ts`
- adapter mapping code in `packages/*/src/mapping.ts`

Status:

- **strong**

What is true:

- adapters provide source facts
- core normalizes those facts into shared semantics
- routing-critical logic is mostly no longer driven by raw source prose

What still matters:

- adapter drift is still one of the biggest practical risks
- host-specific tools and edge cases still need disciplined mapper coverage

### 2. Guardrails And Policy

Question:

- does Aperture keep hard rules stricter than soft value scoring?

Current code anchors:

- `packages/core/src/attention-policy.ts`
- `packages/core/src/policy/`
- `packages/core/src/judgment-config.ts`

Status:

- **strong**

What is true:

- policy is explicit and inspectable
- guardrails are not just buried inside generic scoring
- operator-owned policy can stay stricter than adaptive behavior

What still matters:

- parity with native host permission models
- clearer operator-facing policy visibility over time

### 3. Routing And Continuity

Question:

- can Aperture place work correctly across now, next, and ambient states
  without thrashing the operator?

Current code anchors:

- `packages/core/src/attention-planner.ts`
- `packages/core/src/continuity/`
- `packages/core/src/frame-planner.ts`
- `packages/core/src/task-view-store.ts`

Status:

- **strong, still maturing**

What is true:

- queue and ambient are real routing modes
- continuity is explicit
- episode-aware planning exists

What still matters:

- minimum dwell
- richer episode lifecycle
- stronger interrupt-conflict handling
- broader pattern accumulation

### 4. Surface Fit

Question:

- does the engine plan against the actual capabilities of the surface it is
  embedded in?

Current code anchors:

- `packages/core/src/surface-capabilities.ts`
- `packages/core/src/aperture-core.ts`
- `packages/core/src/attention-planner.ts`

Status:

- **real, but early**

What is true:

- surface capabilities are already part of the engine boundary
- the planner can already respect some host constraints

What still matters:

- richer capability modeling for non-TUI hosts
- cleaner degradation policy
- better separation between host constraints and learned operator behavior

### 5. Learning And Memory

Question:

- does Aperture get meaningfully better from operator behavior over time?

Current code anchors:

- `packages/core/src/attention-signal-store.ts`
- `packages/core/src/signal-summary.ts`
- `packages/core/src/attention-adjustments.ts`
- `packages/core/src/attention-value.ts`
- `packages/core/src/memory-aggregator.ts`
- `packages/core/src/profile-store.ts`

Status:

- **built, not yet mature**

What is true:

- behavior becomes signals
- signals become summaries
- summaries and memory shape future judgment

What still matters:

- stronger replay-driven tuning
- better migration/versioning for persisted state
- a cleaner split between:
  - host constraints
  - explicit operator profile
  - learned operator behavior

### 6. Traceability And Replay

Question:

- can Aperture explain and evaluate its decisions well enough to improve them
  deliberately?

Current code anchors:

- `packages/core/src/judgment-coordinator.ts`
- `packages/core/src/trace.ts`
- `packages/core/src/trace-recorder.ts`
- `packages/core/src/trace-evaluator.ts`

Status:

- **strong foundation**

What is true:

- hot-path decisions are inspectable
- trace data exists
- offline evaluation has a real home

What still matters:

- broader harvested-reality replay
- more consistent evaluator-driven threshold refinement
- making replay a first-class tuning loop, not just infrastructure

## Recommended Use

Use these six pillars as the standing frame for:

- engine status updates
- roadmap communication
- SDK maturity conversations
- release-note callouts for core improvements

## Current Priority Order

Across the six pillars, the next best order is:

1. structured semantics discipline
2. routing and continuity maturation
3. surface fit expansion
4. learning and memory clarity
5. replay-driven tuning

Guardrails and policy should remain strong and conservative throughout, not
treated as a moving target.
