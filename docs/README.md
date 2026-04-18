# Docs

This folder contains the current Aperture documentation.

The docs are organized into seven groups:

- **entry docs** for first orientation
- **release notes** for shipped package cuts
- **product surface docs** for the current product contract
- **source adapter docs** for source-specific integration paths
- **engine and SDK reference docs** for the core judgment model
- **lab docs** for replay, benchmark, and calibration work
- **roadmap and design context docs** for forward-looking or evaluative thinking

## Start Here

Choose the path that matches what you are trying to do.

### Use The Product

1. [README](../README.md)
2. [Aperture v0.4.0](./releases/aperture-v0.4.0.md)
3. [Architecture Overview](./product/architecture-overview.md)
4. [Components](./product/components.md)
5. [TUI Surface](./product/tui.md)

Use this path if you want the local Aperture CLI/TUI product or you want to
understand the current product surface.

### Build With The SDK

1. [packages/core/README.md](../packages/core/README.md)
2. [Aperture Core SDK v0.7.0](./releases/aperture-core-v0.7.0.md)
3. [SDK Path](./product/sdk-path.md)
4. [Core Mental Model](./engine/core-mental-model.md)

Use this path if you want to embed Aperture's judgment engine in-process inside
your own runtime, workflow, or UI.

### Review A Capture

1. [Examples](../examples/README.md)
2. [Capture Review Quickstart](./lab/capture-review-quickstart.md)
3. [Offline AI Review Loop](./lab/offline-ai-review-loop.md)
4. [Aperture Lab](./lab/aperture-lab.md)

Use this path if you want to inspect a real captured session, prepare an
offline-review artifact, or feed a live runtime capture into the Lab review
loop.

## Release Notes

- [Aperture v0.4.0](./releases/aperture-v0.4.0.md)
- [Aperture v0.3.0](./releases/aperture-v0.3.0.md)
- [Aperture v0.2.1](./releases/aperture-v0.2.1.md)
- [Aperture v0.2.0](./releases/aperture-v0.2.0.md)
- [Aperture v0.1.2](./releases/aperture-v0.1.2.md)
- [Aperture v0.1.0](./releases/aperture-v0.1.0.md)
- [Aperture Core SDK v0.7.0](./releases/aperture-core-v0.7.0.md)
- [Aperture Core SDK v0.6.0](./releases/aperture-core-v0.6.0.md)
- [Aperture Core SDK v0.5.0](./releases/aperture-core-v0.5.0.md)
- [Aperture Core SDK v0.4.2](./releases/aperture-core-v0.4.2.md)
- [Aperture Core SDK v0.4.0](./releases/aperture-core-v0.4.0.md)

## Product Surface

- [Architecture Overview](./product/architecture-overview.md)
- [Components](./product/components.md)
- [Adapter Contract](./product/adapter-contract.md)
- [Host-Neutral Ingestion Contract](./product/host-neutral-ingestion-contract.md)
- [Work Event Mapping](./product/work-event-mapping.md)
- [TUI Surface](./product/tui.md)
- [SDK Path](./product/sdk-path.md)
- [Codex Plugin Mockup](./product/codex-plugin-mockup.md)

These docs define the current Aperture product surface:

- what exists today
- what the main packages are
- how the shared runtime and TUI fit together
- what boundaries should stay stable

## Source Adapters

- [Claude Code Adapter](./adapters/claude-code-adapter.md)
- [OpenCode Adapter](./adapters/opencode-adapter.md)
- [Codex Adapter](./adapters/codex-adapter.md)
- [Codex Surfaces](./adapters/codex-surfaces.md)

These docs explain the source-specific integration seams:

- Claude Code as a live hook-based path
- OpenCode as a live server-and-terminal path
- Codex as an experimental App Server path

## Engine And SDK Reference

- [Core Mental Model](./engine/core-mental-model.md)
- [Core Engine Audit (2026-03)](./engine/core-engine-audit-2026-03.md)
- [Engine Status Pillars](./engine/engine-status-pillars.md)
- [Architecture Principles](./engine/architecture-principles.md)
- [Attention And Judgment Doctrine](./engine/attention-judgment-doctrine.md)
- [Aperture Core Ontology](./engine/aperture-core-ontology.md)
- [Core Engine Architecture](./engine/core-engine-architecture.md)
- [Canonical Judgment Model](./engine/canonical-judgment-model.md)
- [Reference Judgment Flow](./engine/reference-judgment-flow.md)
- [Semantic Normalization](./engine/semantic-normalization.md)
- [Attention Frame](./engine/frame.md)
- [SDK Path](./product/sdk-path.md)
- [Interaction Signals](./engine/interaction-signals.md)

These docs explain the deterministic judgment model, the engine boundary, and the SDK-facing contracts.

## Lab

- [Aperture Lab](./lab/aperture-lab.md)
- [Capture Review Quickstart](./lab/capture-review-quickstart.md)
- [JudgmentBench Data Strategy](./lab/judgmentbench-data-strategy.md)
- [Harvested Session Collection Runbook](./lab/harvested-session-collection-runbook.md)
- [Offline AI Review Loop](./lab/offline-ai-review-loop.md)

These docs define the offline replay, benchmark, and calibration layer that
measures and improves Aperture's deterministic hot path.

## Roadmaps And Design Context

- [Roadmaps Index](./roadmap/README.md)
- [Aperture Cloud (Exploration Note)](./roadmap/aperture-cloud.md)
- [Decision Quality Execution Plan](./roadmap/decision-quality-execution-plan.md)
- [Engine Roadmap](./roadmap/engine-roadmap.md)
- [Technical Product Roadmap](./roadmap/technical-product-roadmap.md)
- [Core Maturation Plan](./roadmap/core-maturation-plan.md)

Use the roadmap index to separate current direction from supporting or
historical notes. The Aperture Cloud memo is preserved as future optionality,
not the current product direction.

## Archived

- [Archive Index](./archive/README.md)

Archived docs are kept for implementation history and design provenance. They
should not be treated as the source of truth for the current product surface.
