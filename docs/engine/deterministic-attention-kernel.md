# Deterministic Attention Kernel

Aperture Core should mature into a small embeddable kernel for deterministic
attention judgment over messy semantic event streams.

This is the "SQLite posture" for Aperture: compact, boring, portable,
replayable, inspectable, and trusted.

## Category

Aperture is not a generic semantic engine, workflow runner, agent framework, or
alerting system.

The kernel category is:

```text
messy source events
-> canonical source facts
-> bounded semantic interpretation
-> compact ontology
-> judgment input
-> deterministic attention decision
-> explainable trace
```

The primitive answers one question:

**What deserves human attention, in what form, and why?**

## Kernel Invariants

The kernel should preserve these invariants:

- same input, context, clock, and config produce the same decision
- source facts outrank inference
- semantic hints can refine authority but cannot impersonate source truth
- confidence can demote uncertain reads but should not inflate weak inference
- policy consumes compact judgment input, not raw source prose
- hard policy stays separate from soft value
- continuity is explicit and replayable
- every surfaced decision has reason codes and provenance
- no hidden model calls run in the judgment path
- core stays dependency-light

## Stable Artifacts

The kernel should stabilize these artifacts before widening public API surface:

1. `SourceEvent`
2. `SemanticInterpretation`
3. `SemanticOntologyDiagnostic`
4. `AttentionJudgmentInput`
5. `AttentionCandidate`
6. `AttentionDecisionRecord`
7. `ApertureTrace`

`AttentionDecisionRecord` is the first-class judgment artifact. It binds the
decision, candidate, evidence snapshot, policy evaluations, value calculation,
planning route, ambiguity, continuity evaluations, and reasons into one
replayable object.

## What Stays Out

The kernel should not absorb:

- source adapters
- runtime HTTP hosting
- TUI presentation rules
- product-specific persistence
- host-specific approval UI behavior
- model-provider routing
- semantic embedding dependencies

Those can integrate around the kernel. They should not become the kernel.

## Conformance Path

The next maturity layer is a public conformance suite.

Each conformance case should assert:

- input event and context
- semantic interpretation
- ontology diagnostic
- judgment input
- decision record
- trace reason codes

The suite should include adversarial examples:

- decorative urgency language
- duplicate semantic hints
- stale approvals
- repeated failures
- low-confidence blocked-like statuses
- conflicting relation hints
- passive status noise
- safe read approvals
- high-consequence writes

## Public API Posture

Do not publish a new kernel API just because the internal artifact exists.

The right order is:

1. stabilize the internal artifact
2. lock it with fixtures
3. publish doctrine and compatibility expectations
4. expose a tiny kernel subpath only after replay behavior is stable

The target shape is intentionally small:

```ts
interpret(event) -> SemanticInterpretation
projectOntology(semantic) -> SemanticOntologyDiagnostic
decide(candidate, context) -> AttentionDecisionRecord
explain(record) -> ApertureTrace
```

That shape should remain aspirational until conformance coverage earns it.
