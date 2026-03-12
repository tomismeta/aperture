# Public Docs

These are the docs intended to ship with the first public GitHub version of Aperture.

Recommended reading order for someone new to the repo:

1. [README](../README.md) for the single Claude quickstart path and the two main product entrypoints
2. [TUI Surface](tui.md) for how to read the operator surface
3. [Components](components.md) for the current package/runtime architecture
4. adapter docs like [Claude Code Adapter](claude-code.md), [Codex Adapter](codex.md), or [Paperclip Adapter](paperclip.md) as needed

- [Components](components.md)
- [Semantic Normalization](semantic-normalization.md)
- [Frame](frame.md)
- [Claude Code Adapter](claude-code.md)
- [Codex Adapter](codex.md)
- [Paperclip Adapter](paperclip.md)
- [TUI Surface](tui.md)
- [TUI Design](tui-design.md)
- [Engine Roadmap](engine-roadmap.md)
- [First Publish Checklist](publish-checklist.md)
- [Interaction Signals](interaction-signals.md)
- [Human Attention Research](human-attention-research.md)
- [Agent Workforce Use Case](agent-workforce-use-case.md)

Everything in this set matches the current engine-first product:

- a small attention engine in `@aperture/core`
- a shared local host in `@aperture/runtime`
- Claude Code, Paperclip, and Codex adapters as real adapter paths into that host
- a source-agnostic TUI as the primary companion surface
