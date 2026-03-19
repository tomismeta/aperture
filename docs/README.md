# Docs

This folder contains the current Aperture documentation.

The docs are organized into five groups:

- **entry docs** for first orientation
- **product surface docs** for the current product contract
- **source adapter docs** for source-specific integration paths
- **engine and SDK reference docs** for the core judgment model
- **roadmap and design context docs** for forward-looking or evaluative thinking

## Start Here

1. [README](../README.md)
2. [Architecture Overview](./product/architecture-overview.md)
3. [Components](./product/components.md)
4. [Adapter Contract](./product/adapter-contract.md)
5. [TUI Surface](./product/tui.md)

If you are new to the repo, that path gives the fastest accurate picture of the product.

## Product Surface

- [Architecture Overview](./product/architecture-overview.md)
- [Components](./product/components.md)
- [Adapter Contract](./product/adapter-contract.md)
- [TUI Surface](./product/tui.md)
- [SDK Path](./product/sdk-path.md)

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

- [Architecture Principles](./engine/architecture-principles.md)
- [Attention And Judgment Doctrine](./engine/attention-judgment-doctrine.md)
- [Core Engine Architecture](./engine/core-engine-architecture.md)
- [Canonical Judgment Model](./engine/canonical-judgment-model.md)
- [Reference Judgment Flow](./engine/reference-judgment-flow.md)
- [Semantic Normalization](./engine/semantic-normalization.md)
- [Attention Frame](./engine/frame.md)
- [Aperture Lab](./engine/aperture-lab.md)
- [SDK Path](./product/sdk-path.md)
- [Interaction Signals](./engine/interaction-signals.md)

These docs explain the deterministic judgment model, the engine boundary, and the SDK-facing contracts.

## Roadmaps And Design Context

- [Engine Roadmap](./roadmap/engine-roadmap.md)
- [Core Maturation Plan](./roadmap/core-maturation-plan.md)
- [Technical Product Roadmap](./roadmap/technical-product-roadmap.md)
- [Human Attention Research](./roadmap/human-attention-research.md)
- [Engine Architecture Evaluation](./roadmap/engine-architecture-evaluation.md)
- [Agent Workforce Use Case](./roadmap/agent-workforce-use-case.md)
- [TUI Design](./roadmap/tui-design.md)

These docs are useful when you want to understand why the product is shaped this way or where it should go next.

## Archived

- [Archive Index](./archive/README.md)

Archived docs are kept for implementation history and design provenance. They
should not be treated as the source of truth for the current product surface.
