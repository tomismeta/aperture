# Observation Kernel Portability

This note records how Aperture's Observation Kernel can stay host-neutral while
remaining portable to event-log architectures, including Buzz-style systems.

## Boundary

Aperture core must not contain Buzz-specific concepts, event kinds, crate names,
protocol assumptions, or product strings. The portable primitive is the
Observation-to-Judgment contract, not a Buzz adapter.

Buzz is useful as one reference architecture because it is organized around
signed events in one relay-owned log, a zero-I/O core crate, and small
protocol-native agent surfaces. Those constraints are compatible with
Aperture's goal, but they should not determine Aperture's core ontology.

References:

- Buzz README: https://github.com/block/buzz
- Buzz architecture: https://github.com/block/buzz/blob/main/ARCHITECTURE.md
- Buzz agent vision: https://github.com/block/buzz/blob/main/VISION_AGENT.md

## Portable Contract

The minimal portable contract is:

1. Convert a host event into a normalized observation document.
2. Project the observation into a deterministic judgment contract.
3. Let attention, routing, recovery, and trace surfaces consume that projection.

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

## What Would Port Natively

For a Rust/event-log host like Buzz, the native port would be small:

- `Observation`: a struct equivalent to Aperture's normalized observation
  document.
- `ObservationJudgmentContract`: a struct equivalent to the derived projection.
- `observe(event) -> Option<Observation>`: host-specific parsing from signed
  events into the normalized document.
- `judge_observation(observation) -> ObservationJudgmentContract`: pure,
  deterministic, no I/O.
- Conformance fixtures: committed JSON inputs/outputs for messy event families.

The host would decide where to store and emit the judgment result. In Buzz, that
could become a relay-side derived event, an agent-side read model, or an
attention/routing helper in a focused crate. Aperture should not choose that for
Buzz inside core.

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

The versioned Observation Kernel scorecard now covers structured output, search
output, and a source-limit recovery flow. It snapshots both normalized
observation fields and the derived judgment projection, so drift in the portable
contract is visible before release.

The core decision path also consumes the projection directly: status-conflict,
limited-failure helpers, stable peripheral status evidence, and visible
diagnostic failure policy all route through normalized observations instead of
raw task-failure evidence.
