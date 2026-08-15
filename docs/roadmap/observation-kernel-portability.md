# Observation Kernel Portability

This note records how Aperture's Observation Kernel can stay host-neutral while
remaining portable to event-log architectures.

## Boundary

Aperture core must not contain host-specific concepts, event kinds, crate names,
protocol assumptions, or product strings. The portable primitive is the
Observation-to-Judgment contract, not a host adapter.

## Portable Contract

The minimal portable contract is:

1. Convert a host event into a kernel-owned neutral event DTO.
2. Normalize that DTO into a finalized event and, when available, a canonical
   Observation document.
3. Judge the Observation with the one deterministic judgment function.
4. Explain the result with stable reason codes.
5. Let attention, routing, recovery, and trace surfaces consume that projection.

In Aperture today, the normalized observation document carries:

- kind
- polarity
- ownership
- subject
- evidence loss
- evidence strength
- semantic agreement
- diagnostic class
- recovery hint
- provenance
- consequence baseline

The judgment projection in
`packages/core/src/judgment-observation-contract.ts` derives:

- limited failure status
- visible diagnostic failure
- stable status evidence
- observational status-conflict kind

That projection is event-agnostic: it consumes only the normalized observation,
not `SourceEvent`, adapter payloads, raw task-failure evidence, or product
labels.

The TypeScript package exposes that boundary as:

- `ApertureKernelEvent`: the minimal neutral event DTO.
- `evaluateApertureKernelEvent(event)`: normalize, observe, judge, and return
  stable explanation reason codes.
- `runApertureKernelConformance(adapter, cases)`: exercise the public evaluator
  from a host adapter, compare canonical outputs, and verify repeated-run
  determinism without importing Lab or a test framework.

Hosts map arbitrary native event shapes into the neutral DTO outside core. Core
does not export an adapter abstraction for that mapping.

## What Would Port Natively

For an event-log host, the native port would be small:

- `Observation`: the one canonical semantic document returned by the kernel.
- `ObservationJudgment`: the pure deterministic judgment result consumed by
  attention policy.
- `observe(event) -> Option<Observation>`: host-specific parsing from signed
  events into the canonical document.
- `judgeObservation(observation) -> ObservationJudgment`: pure,
  deterministic, no I/O.
- `explain(result) -> Vec<ReasonCode>`: stable machine-readable explanation,
  leaving prose to the host surface.
- Conformance fixtures: committed JSON inputs/outputs for messy event families.

The host would decide where to store and emit the judgment result. It could
become a derived event, a read model, or an attention/routing helper in a
focused module. Aperture core should not choose host storage or protocol shape.

## What Stays Aperture-Specific

These should not be ported as-is:

- TypeScript package layout and npm release mechanics.
- Adapter-specific SourceEvent mapping.
- TUI and runtime surfaces.
- Lab corpus import machinery.
- Exact corpus/product fixture strings outside conformance tests.
- Existing semantic detector module shape.

The durable idea is the small observation document plus deterministic judgment
projection, not the surrounding product shell.

## Current Evidence

The Observation Kernel scorecard measures 13 canonical Observation
fields, eight derived judgment fields, two decision fields, and exact outcomes.
The implementation-freeze baseline covers structured output, search output,
source-limit recovery, title-independent command success, and other messy
structural families as calibration evidence. An independently authored
post-freeze holdout is still required before release. Drift is attributed to
semantics, judgment, or end-to-end decision behavior instead of being hidden in
an aggregate snapshot.

The public kernel entrypoint has a host-neutral portability fixture at
`packages/core/test/fixtures/kernel-portability.json`. It feeds two unrelated
synthetic host event shapes through adapter-owned mappings and asserts the same
canonical Observation, deterministic ObservationJudgment, and explanation
reason codes. The consumer-facing runner executes both mappings through the
same public evaluator twice. The fixture vocabulary is kept out of
`packages/core/src/kernel.ts` by contract test.

The packed SDK proof additionally executes
`examples/core-kernel-host-embedder/index.ts` against the installed npm tarball.
That reference embedder keeps both host adapters outside core and proves the
public package surface, not a source-tree-only seam.

The core decision path also consumes the projection directly: status-conflict,
limited-failure helpers, stable peripheral status evidence, and visible
diagnostic failure policy all route through normalized observations instead of
raw task-failure evidence.

The task-failure text evidence that feeds this path is now compressed into an
internal shape profile before normalization. That profile is useful for keeping
the parser small, but it is not the portable contract. Hosts should port the
normalized observation document and deterministic judgment projection, not the
raw text-shape machinery.
