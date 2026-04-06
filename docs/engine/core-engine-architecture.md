# Core Engine Architecture

This note captures the post-rearchitecture shape of Aperture core.

It is not a philosophy document. The governing philosophy lives in
[Attention And Judgment Doctrine](attention-judgment-doctrine.md).

This document answers a narrower question:

- where does new judgment behavior go?
- which abilities core must own directly vs which can be cleanly decoupled?

## Engine Hierarchy

There is one important semantic handoff before the lane hierarchy starts:

`SourceEvent/ApertureEvent -> finalized event (usually EnrichedApertureEvent) -> AttentionJudgmentInput -> AttentionCandidate`

That seam mainly lives in:

- `packages/core/src/semantic-interpreter.ts`
- `packages/core/src/semantic-normalizer.ts`
- `packages/core/src/judgment-input.ts`
- `packages/core/src/event-evaluator.ts`

After that handoff, the hot path reads as:

1. `evidence`
2. `policy gates`
3. `evaluation`
4. `policy criterion`
5. `routing`
6. `continuity`
7. `frame`
8. `feedback`

The key implementation anchors are:

- `AttentionJudgmentInput` in `packages/core/src/judgment-input.ts`
- `AttentionEvidenceContext` in `packages/core/src/attention-evidence.ts`
- `AttentionPolicy.evaluateGates(...)` in `packages/core/src/attention-policy.ts`
- `AttentionPolicy.evaluateInterruptCriterion(...)` in `packages/core/src/attention-policy.ts`
- `AttentionPlanner.route(...)` in `packages/core/src/attention-planner.ts`
- `AttentionPlanner.applyContinuity(...)` in `packages/core/src/attention-planner.ts`

## Ability Boundaries

The cleanest way to preserve core integrity is to keep one authoritative
judgment path while allowing support machinery to split out around it.

### Current Ability Taxonomy

At the highest level, Aperture Core currently has six top-level abilities:

1. ability to ingest
2. ability to understand
3. ability to judge
4. ability to materialize
5. ability to learn
6. ability to explain

Those break down into lower-level abilities like this:

- ability to ingest
  - accept input
  - validate it
  - finalize it for runtime use
- ability to understand
  - infer semantics
  - project ontology
  - compile judgment input
  - reason about continuity
- ability to judge
  - evaluate
  - apply policy, value, pressure, and planning
  - choose the resulting route
- ability to materialize
  - commit frames
  - update views
  - handle responses
- ability to learn
  - record signals
  - summarize behavior
  - checkpoint memory
- ability to explain
  - preserve event transitions
  - preserve candidate/frame transitions
  - expose semantic and judgment rationale

### Abilities Core Must Own

These abilities define Aperture itself and should stay in the core runtime path:

- ability to accept raw `SourceEvent` or `ApertureEvent` input
- ability to validate event contracts before judgment
- ability to finalize events into the canonical runtime form
- ability to interpret semantics from source facts and bounded hints
- ability to project semantics into the compact ontology
- ability to compile ontology and semantic evidence into `AttentionJudgmentInput`
- ability to evaluate an event into `noop`, `clear`, or `candidate`
- ability to reason about continuity and episode identity
- ability to apply policy, value, pressure, and planning
- ability to materialize `AttentionFrame`, task view, and global attention view state
- ability to accept human responses and turn them into signals
- ability to update durable memory inputs from those signals

If any of these become fragmented across multiple paths, core integrity starts
to erode.

### Abilities Core Currently Owns Directly

After the orchestration cleanup, the remaining core-owned abilities are
deliberately the ones closest to the judgment heart:

- ability to run the one authoritative publish loop
- ability to assemble runtime evidence for judgment
- ability to prepare candidates for judgment
- ability to invoke evaluation, continuity, policy, value, and planning
- ability to mutate authoritative frame, task, and global attention state
- ability to handle response-driven state transitions
- ability to record signals at the moments those state changes actually happen

This is a healthy stopping point. What remains in the runtime orchestrator is
mostly the real engine rather than surrounding support machinery.

### Abilities That Can Be Decoupled

These can move into helpers or managers as long as they still feed the single
core-owned path above:

- ability to register and notify listeners
- ability to prepare publish transitions and diff metadata around event ingress
- ability to compute trace diffs and project internal trace into public trace
- ability to load markdown-backed config and memory
- ability to rebuild coordinator state from loaded config and memory
- ability to persist distilled memory and runtime artifacts
- ability to validate input shapes through shared validator helpers

The rule is simple:

- core should still read as one conductor
- extracted modules should supply support machinery, not alternate judgment paths

### Supporting Abilities Already Decoupled

The current support seams are:

- ability to prepare publish-time events
- ability to validate runtime inputs
- ability to register and notify listeners
- ability to load, reload, and checkpoint markdown-backed runtime state
- ability to normalize runtime setup and rebuild coordinator state
- ability to assemble publish-time trace snapshots
- ability to build runtime signal objects

These are intentionally support-only seams. They should never become alternate
judgment paths.

### Current Extraction Guidance

There are no large obvious extractions left without getting much closer to
state mutation and continuity-sensitive runtime behavior.

At this point, further splitting should be rare and justified by all of these:

1. the ability is clearly support-only
2. the extraction makes the publish path easier to read
3. the extraction does not create a second place to reason about state or judgment

The judgment pipeline itself should stay singular:

`raw/source event -> finalized event -> semantics -> ontology -> judgment input -> candidate -> judgment -> frame/trace`

## Lane Ownership

Each lane owns one kind of decision.

- `evidence`
  - assembles what the engine knows right now around a candidate
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
