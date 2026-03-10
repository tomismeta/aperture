# TUI Surface

`@aperture/tui` is an optional terminal-native surface for [`@aperture/core`](../packages/core/src/index.ts).

It does not know about Paperclip, Codex, Claude Code, or any other source. It only consumes core contracts:

- `AttentionView`
- `Frame`
- `FrameResponse`

## What it supports today

- full-screen terminal rendering of active, queued, and ambient work
- keyboard-driven responses for:
  - approvals
  - choices
  - forms
- score and rationale display from frame metadata

## What it does not support yet

- mouse interaction
- source-specific rendering
- persistence
- alternate themes or layouts

## Demo

Run the tri-source TUI demo:

```bash
pnpm demo:tui
```
