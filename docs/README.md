# Docs

This folder contains three kinds of documentation:

- **current product docs** for the live Aperture surface
- **current reference docs** for the engine and SDK
- **archived docs** for historical plans and shipped specs

If you are new to the repo, read the current product docs first.

## Start Here

1. [README](../README.md)
2. [TUI Surface](./tui.md)
3. [Components](./components.md)
4. [System Architecture Diagram](./system-architecture-diagram.md)
5. [Claude Code Adapter](./claude-code.md)
6. [OpenCode Adapter](./opencode-integration.md)
7. [Adapter Contract](./adapter-contract.md)

## Current Product Docs

- [TUI Surface](./tui.md)
- [Components](./components.md)
- [Adapter Contract](./adapter-contract.md)
- [Claude Code Adapter](./claude-code.md)
- [OpenCode Adapter](./opencode-integration.md)
- [System Architecture Diagram](./system-architecture-diagram.md)

These are the best entrypoints for understanding what Aperture is today:

- a deterministic human attention engine in `packages/core`
- a shared local host in `@aperture/runtime`
- Claude Code and OpenCode as the live adapter paths
- Codex as an experimental adapter path with a clean but still limited boundary
- a source-agnostic TUI with operator mode and `why` inspection mode

## Current Reference Docs

- [Architecture Principles](./architecture-principles.md)
- [Attention And Judgment Doctrine](./attention-judgment-doctrine.md)
- [Core Engine Architecture](./core-engine-architecture.md)
- [Canonical Judgment Model](./canonical-judgment-model.md)
- [Codex App Server Architecture](./codex-app-server-architecture.md)
- [Codex Integration Paths](./codex-integration-paths.md)
- [Reference Judgment Flow](./reference-judgment-flow.md)
- [Semantic Normalization](./semantic-normalization.md)
- [Attention Frame](./frame.md)
- [Engine Roadmap](./engine-roadmap.md)
- [Core Maturation Plan](./core-maturation-plan.md)
- [SDK Path](./sdk-path.md)
- [Technical Product Roadmap](./technical-product-roadmap.md)
- [Interaction Signals](./interaction-signals.md)
- [Human Attention Research](./human-attention-research.md)

These docs explain how the engine works, how it should evolve, and how the SDK
boundary should stay clean over time.

## Background / Design Context

- [TUI Design](./tui-design.md)
- [Agent Workforce Use Case](./agent-workforce-use-case.md)
- [Engine Architecture Evaluation](./engine-architecture-evaluation.md)

These are useful context docs, but they are not the primary product contract.

## Archived

- [Archive Index](./archive/README.md)
- [TUI Redesign Spec](./archive/tui-redesign-spec.md)
- [OpenCode Implementation Plan](./archive/opencode-implementation-plan.md)
- [Judgment Layer Implementation Spec](./archive/judgment-layer-implementation-spec.md)
- [First Publish Checklist](./archive/publish-checklist.md)

Archived docs are kept for implementation history and design provenance. They
should not be treated as the source of truth for the current product surface.
