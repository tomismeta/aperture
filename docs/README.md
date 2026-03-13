# Public Docs

These are the docs intended to ship with the first public GitHub version of Aperture.

Recommended reading order for someone new to the repo:

1. [README](../README.md) for the product overview and single quickstart path
2. [TUI Surface](tui.md) for how to read the human attention surface
3. [Components](components.md) for the package/runtime architecture
4. [Claude Code Adapter](claude-code.md) if you are using the current live integration

Primary docs:

- [TUI Surface](tui.md)
- [Components](components.md)
- [Claude Code Adapter](claude-code.md)

Reference docs:

- [Semantic Normalization](semantic-normalization.md)
- [Frame](frame.md)
- [Codex Adapter](codex.md)
- [Paperclip Adapter](paperclip.md)
- [TUI Design](tui-design.md)
- [Engine Roadmap](engine-roadmap.md)
- [Interaction Signals](interaction-signals.md)
- [Human Attention Research](human-attention-research.md)
- [Agent Workforce Use Case](agent-workforce-use-case.md)
- [First Publish Checklist](publish-checklist.md)

Everything in this set matches the current engine-first product:

- a judgment engine in `@aperture/core`
- a shared local host in `@aperture/runtime`
- Claude Code as the current live adapter path
- Codex and Paperclip as additional adapters with different transport maturity
- a source-agnostic TUI as the primary companion surface
