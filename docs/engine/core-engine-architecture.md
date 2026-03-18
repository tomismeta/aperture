# Core Engine Architecture

This note captures the post-rearchitecture shape of Aperture core.

It is not a philosophy document. The governing philosophy lives in
[Attention And Judgment Doctrine](attention-judgment-doctrine.md).

This document answers a narrower question:

- where does new judgment behavior go?

## Engine Hierarchy

The hot path now reads as:

1. `evidence`
2. `policy gates`
3. `evaluation`
4. `policy criterion`
5. `routing`
6. `continuity`
7. `frame`
8. `feedback`

The key implementation anchors are:

- `AttentionEvidenceContext` in `packages/core/src/attention-evidence.ts`
- `AttentionPolicy.evaluateGates(...)` in `packages/core/src/attention-policy.ts`
- `AttentionPolicy.evaluateInterruptCriterion(...)` in `packages/core/src/attention-policy.ts`
- `AttentionPlanner.route(...)` in `packages/core/src/attention-planner.ts`
- `AttentionPlanner.applyContinuity(...)` in `packages/core/src/attention-planner.ts`

## Lane Ownership

Each lane owns one kind of decision.

- `evidence`
  - assembles what the engine knows right now
  - examples: current frame, episode state, signal summaries, pressure forecast, surface capabilities
- `policy gates`
  - decides whether a candidate is eligible for interruptive treatment at all
  - examples: configured policy, blocking work, background work, peripheral status defaults
- `evaluation`
  - computes candidate utility
  - examples: priority, consequence, tone, blocking, memory adjustments
- `policy criterion`
  - decides whether the candidate clears the current interrupt threshold
  - examples: activation threshold, promotion margin, ambiguity resolution
- `routing`
  - decides the base placement
  - examples: activate, queue, ambient, suppress
- `continuity`
  - decides whether the base route should actually replace current work
  - examples: minimum dwell, same episode, burst dampening, conflicting interrupt resolution
- `frame`
  - materializes the human-facing representation
- `feedback`
  - records what the human did and feeds future evidence/memory

## Rule Contracts

Rule modules should stay small and lane-local.

Current internal contracts:

- continuity rules:
  - `ContinuityRuleInput -> ContinuityRuleEvaluation`
  - source: `packages/core/src/continuity/continuity-rule.ts`
- policy gate rules:
  - `PolicyGateRuleInput -> PolicyGateRuleEvaluation`
  - source: `packages/core/src/policy/policy-gate-rule.ts`

Both follow the same pattern:

- pure function
- small named file
- explicit rationale
- no adapter or surface backwash

## Composition Model

Lane composition is explicit.

- `policy gates`
  - evaluated in rule order
  - first rule returning a verdict wins
- `continuity`
  - all rules evaluate against the same routed input
  - first override wins
  - full evaluations remain traceable

This means we preserve:

- deterministic outcomes
- local reasoning
- rule-level auditability

## Where New Behavior Goes

When adding new behavior, answer this first:

1. is it `evidence`?
2. is it `policy`?
3. is it `routing`?
4. is it `continuity`?
5. is it `feedback`?

If the answer is unclear, the behavior is probably underspecified.

### Add a new rule when:

- the behavior belongs to one lane
- the input is already available in that lane
- the behavior has a clear rationale and precedence story

### Do not add a new rule when:

- it spans multiple lanes without a clear owner
- it requires adapters or surfaces to leak semantics into core
- it is really a threshold/config concern that should extend an existing rule

## File Placement

Use these directories:

- `packages/core/src/policy/`
- `packages/core/src/continuity/`

Keep new rules:

- one file per rule
- named after the doctrine or behavior
- tested in the most relevant existing test file before adding a new test file

## Current Pattern Check

The rearchitecture is considered healthy when new behavior can land as:

- one rule file
- one composition change
- one or two focused tests

without changing unrelated lanes.
