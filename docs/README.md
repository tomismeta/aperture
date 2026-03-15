# Public Docs

These are the docs intended to ship with the first public GitHub version of Aperture.

Recommended reading order for someone new to the repo:

1. [README](../README.md) for the product overview, shared-stack model, and full-stack quickstarts
2. [TUI Surface](tui.md) for how to read the human attention surface
3. [Components](components.md) for the package/runtime architecture
4. [Claude Code Adapter](claude-code.md) for the Claude Code live source path
5. [OpenCode Integration](opencode-integration.md) for the OpenCode live source path

Primary docs:

- [TUI Surface](tui.md)
- [Components](components.md)
- [Claude Code Adapter](claude-code.md)
- [OpenCode Integration](opencode-integration.md)

Reference docs:

- [Semantic Normalization](semantic-normalization.md)
- [Attention Frame](frame.md)
- [Codex Adapter](codex.md)
- [OpenCode Integration](opencode-integration.md)
- [OpenCode Implementation Plan](opencode-implementation-plan.md)
- [Paperclip Adapter](paperclip.md)
- [TUI Design](tui-design.md)
- [Engine Roadmap](engine-roadmap.md)
- [Reference Judgment Flow](reference-judgment-flow.md)
- [SDK Path](sdk-path.md)
- [Technical Product Roadmap](technical-product-roadmap.md)
- [Interaction Signals](interaction-signals.md)
- [Human Attention Research](human-attention-research.md)
- [Agent Workforce Use Case](agent-workforce-use-case.md)
- [First Publish Checklist](publish-checklist.md)

Everything in this set matches the current engine-first product:

- a human attention control plane in the core package (`packages/core`, published as `@tomismeta/aperture-core`)
- a shared local host in `@aperture/runtime`
- Claude Code and OpenCode as current first-class live adapter paths
- Codex and Paperclip as additional adapters with different transport maturity
- a source-agnostic TUI as the primary companion surface
