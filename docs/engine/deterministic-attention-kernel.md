# Deterministic Attention Kernel

Aperture Core should mature into a small embeddable kernel for deterministic
attention judgment over messy semantic event streams.

This is the portability posture for Aperture: compact, boring, portable,
replayable, inspectable, and trusted.

For term boundaries, see [Attention Kernel Lexicon](./attention-kernel-lexicon.md).

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
- every candidate decision has stable reason codes and provenance
- no hidden model calls run in the judgment path
- core stays dependency-light

## Stable Artifacts

The kernel stabilizes these artifacts through internal conformance and narrow
public subpaths:

1. `SourceEvent`
2. `SemanticInterpretation`
3. `AttentionOntologyDiagnostic`
4. `NormalizedObservation`
5. `ObservationJudgmentContract`
6. `AttentionJudgmentInput`
7. `AttentionCandidate`
8. `AttentionDecisionRecord`
9. `ApertureTrace`

`AttentionOntologyDiagnostic` is the compact, canonical ontology vocabulary.
Core exports no parallel semantic-era ontology contract.

`NormalizedObservation` is the typed semantic document between messy source
evidence and deterministic judgment. `ObservationJudgmentContract` is its pure
judgment projection. The public kernel exposes bounded copies of these artifacts
as `ApertureKernelObservation` and `ApertureKernelObservationJudgment`; those are
public DTO projections of the same path, not a second semantic or judgment
implementation.

`AttentionDecisionRecord` is the first-class judgment artifact. It binds the
decision, claim, evaluation clock, evidence snapshot, policy evaluations, value calculation,
planning route, ambiguity, continuity evaluations, and reasons into one
replayable object.

Its `planning.reasonCodes` are stable machine-readable tags for conformance and
offline analysis. The prose `planning.reasons` remain human-facing explanation
and may change as language improves; fixtures should prefer reason codes for
route, lane, policy, evidence, pressure, ambiguity, and continuity guarantees.

The Lab conformance projection is versioned separately from the internal record.
Projection version `2` covers the flattened decision fields captured in replay
decision snapshots: route, planned lane, realized lane, evidence identity,
operator presence, candidate score, value components, prose reasons, reason
codes, and a stable `sha256:` fingerprint. Additive structurally valid policy,
criterion, and continuity rule codes remain compatible within version `2`; field
removal, renaming, or semantic reinterpretation requires a new projection
version. The determinism audit normalizes these projection fields so kernel
drift is visible even when the final attention view does not change.
Projection version `1` snapshots remain readable inside session bundle schema
`1` artifacts, but current conformance writers emit version `2`.
Replay decision snapshots still carry the legacy `resultLane` source field; the
version `2` projection exposes that placement as `realizedLane`.

The fingerprint hashes the decision-bearing projection only: schema version,
route, planned lane, realized lane, evidence, candidate score, value components,
and reason codes. It intentionally excludes prose reasons so explanation wording
can improve without pretending the kernel changed.

Lab canonicalization uses a kernel-local JSON writer:

- object keys sort by code-unit order, not locale
- array order remains meaningful
- `undefined`, sparse arrays, `NaN`, and infinities are rejected
- digests are SHA-256 over UTF-8 canonical JSON bytes

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

The Lab golden replay path is the conformance harness. The required kernel
compatibility fixtures live under `packages/lab/golden/kernel/` and assert
compact, deterministic projections of the internal record rather than copying
every nested trace field. The exact compatibility suite is declared in
`packages/lab/src/kernel-profile.ts` and materialized as
`packages/lab/conformance/kernel-v2.json`. The historical version `1` report is
kept beside it for comparison, but new kernel conformance updates target
version `2`.

The extended messy-event corpus lives beside it under
`packages/lab/golden/kernel-corpus/`. That corpus is not the compatibility
profile. It is a growing pressure-test suite for source authority, relation
targets, status noise, episode resolution, operator absence, and other messy
event-stream behavior. Its profile is declared in
`packages/lab/src/kernel-corpus-profile.ts` and materialized as
`packages/lab/conformance/kernel-corpus-v2.json`. The corpus gate fails closed
when a case lacks final-lane assertions, a step-labeled semantic ontology
checkpoint, a decision projection checkpoint, dimension assignment, or
repeated-run determinism.

Each conformance case should assert:

- input event and context
- semantic interpretation
- ontology diagnostic
- judgment input projection when it is decision-bearing
- decision record route, planned lane, realized lane, evidence identity,
  presence, and value score
- prose reasons only when the wording itself is part of the case
- value components as an open numeric map; fixtures should assert only the
  components that are semantically important for that case
- stable decision reason codes from the record projection
- the canonical decision fingerprint generated from the projection

The version 2 Observation Kernel scorecard adds field-level quality evidence
over that path. Human-authored expected values can be scored separately for
calibration and holdout fixture splits across normalized Observation fields,
the derived observation judgment, planner behavior, realized lane, and exact
end-to-end outcomes. The implementation-freeze scorecard contains only
calibration evidence; a holdout must be authored independently after that
freeze and executed without semantic tuning before release. A scorecard drift
therefore identifies which boundary changed instead of reporting only that a
final route moved.

The current kernel fixture matrix covers:

- `activate` with no current frame and operator present
- `queue` under operator absence
- `queue` behind a stronger same-task current frame
- `ambient` for passive status noise
- `auto_approve` for configured bounded low-risk reads
- decorative urgency language that remains ambient under source-fact authority
- low-confidence failure ambiguity that stays visible in next
- continuity override activation for resurfacing same-episode work

The current messy corpus covers:

- alarmist read-only approval language that stays low consequence
- high source risk that survives a low-confidence semantic hint
- conflicting relation targets that preserve final queueing behind current work
- duplicate relation hints that canonicalize to targeted source evidence
- low-confidence repeated failures that stay queued behind ambiguity pressure
- metadata-heavy status noise that remains ambient
- repeated same-issue failures that refresh the current episode without duplicate focus pressure
- repeated passive statuses that remain one ambient frame
- same-issue resolution after an active failure
- delayed lifecycle replays that cannot retire or inflate a fresh recurrence
- waiting status with blocking wording under operator absence
- interleaved background noise between same-episode superseding approvals
- superseding approval that replaces an active step and clears an obsolete queued approval

The corpus should continue adding adversarial examples:

- decorative urgency language
- conflicting relation hints
- passive status noise
- safe read approvals
- high-consequence writes

## Scale Characterization

`pnpm kernel:scale` evaluates a fixed mixed-event workload in repeated rounds
through `evaluateApertureKernelEvent(...)`. Every round must produce the same
SHA-256 digest over the complete canonical public result stream. The command
reports throughput, round-mean latency, and heap movement while applying only a
coarse performance regression floor.

Machine-specific timing is not committed as a golden compatibility artifact.
See [Kernel Scale Characterization](./kernel-scale-characterization.md) for the
workload and release invariants.

## Public API Posture

Decision as of 2026-08-03: keep the root package stateful, but publish narrow
pure subpaths for embedders.

The public `semantic` subpath exposes the canonical attention ontology entry
point and no parallel semantic-era aliases. The public `evaluator` subpath
exposes `evaluateAttention(...)`, which evaluates one
`AttentionClaim` against explicit context, config, and clock input and returns a
versioned `AttentionDecisionRecord`.

The evaluator is deliberately narrower than Core:

- no event ingestion
- no state mutation
- no response application
- no replay-session API
- no persistence
- no realized lane

`ApertureCore` remains the public stateful engine for
`event -> frame/view -> response` workflows. Lab replay and conformance remain
the compatibility harness for messy event streams and realized-lane behavior.

The public `kernel` subpath exposes an even smaller event-facing primitive for
hosts that do not want Core's stateful surface loop:

```ts
evaluateApertureKernelEvent(event) -> {
  event,
  evaluation,
  observation,
  observationJudgment,
  explanation
}
```

Its host boundary is:

```ts
host event -> adapter-owned ApertureKernelEvent -> normalize -> observe -> judge
```

The adapter returns `ApertureKernelEvent | null`; accepted events are passed to
`evaluateApertureKernelEvent(...)`. The kernel does not import source adapters,
host protocols, product strings, persistence, networking, or UI behavior.

The architecture shape is intentionally small:

```ts
interpret(event) -> SemanticInterpretation
projectOntology(semantic) -> AttentionOntologyDiagnostic
evaluateAttention({ claim, context, config, now }) -> AttentionDecisionRecord
evaluateApertureKernelEvent(event) -> observation + observation judgment + explanation codes
```

The kernel explanation is deliberately code-first: stable reason codes describe
normalization, candidate evaluation, observation presence, judgment status
evidence, status-conflict handling, recovery posture, and baseline consequence.
Prose explanation remains a UI or trace-rendering concern.
