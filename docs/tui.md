# TUI Surface

`@aperture/tui` is an optional terminal-native surface for [`@tomismeta/aperture-core`](../packages/core/src/index.ts).

It is source-agnostic. It does not know about Claude Code, OpenCode, Codex, or
any other producer directly. It only consumes core contracts such as:

- `AttentionView`
- `AttentionFrame`
- `AttentionResponse`
- `ApertureTrace`

The TUI now has two primary modes:

- **operator mode** — calm default surface
- **why mode** — opt-in judgment inspection via `[y]`

## The Screen Model

The screen is organized into four practical regions:

1. **Header**
2. **Active now**
3. **Queue / ambient**
4. **Controls + status**

The point is not to show everything. The point is to show what deserves the
human next while keeping background work visible but quiet.

## Header

The header shows:

- active count
- queued count
- ambient count
- a global posture indicator:
  - `○ calm`
  - `◐ elevated`
  - `● busy`

That posture is derived from real engine burden/pressure state, not just frame
tone.

## Active Now

The active frame is the one thing Aperture thinks deserves the operator first.

The active pane shows:

- **Title** — what is happening, in plain language
- **Source** — where it came from
- **Mode**:
  - `approval`
  - `choice`
  - `form`
  - `status`
- **Urgency** — `low urgency`, `needs attention`, or `urgent`
- **Risk** — `low risk`, `medium risk`, or `high risk`
- **Summary** — a short human-readable explanation
- **Judgment line** — one short reason for why Aperture put this item here
- **Context** — the first 1-2 context items are visible by default; more appear behind `[space]`

The default active pane is intentionally calm. It should answer:

- what is this
- what should I do
- why is it here now

without turning the surface into a trace console.

## Queue

The queue contains work that matters, but not enough to displace the current
active item.

Queued items are:

- compact
- ranked
- visible for orientation

When the active frame resolves, the top queued item can promote to active.

## Ambient

Ambient items are awareness-only.

They are useful to keep visible, but they should not interrupt. Typical ambient
items include:

- passive status updates
- completed work
- low-priority notifications

## Controls

The controls line at the bottom of the screen is the source of truth for what
you can do right now.

Typical controls:

| Controls shown | What it means |
| --- | --- |
| `[a] approve  [r] reject  [x] dismiss` | Approval decision |
| `[enter] ack` | Acknowledge the current informational item |
| `[1-9] choose` | Pick an option in a choice interaction |
| `[i] input` or `[i] reply` | Start typing for forms or text-enabled choices |
| `[space] detail` | Toggle extra context and debug detail |
| `[y] why` | Open the judgment inspection view |
| `[q] quit` | Exit the TUI |

When typing:

- `[enter]` advances or submits
- `[esc]` cancels editing

## Why Mode

Press `[y]` to inspect the current judgment trace.

Why mode keeps the active frame visible and replaces the lower part of the
screen with the routed explanation. It shows:

- decision route and surfaced bucket
- candidate score and current score
- policy gate outcomes
- criterion outcomes
- continuity outcomes

This is where the engine becomes inspectable without forcing operators to read
rule machinery by default.

## What The TUI Supports Today

- full-screen rendering of active, queued, and ambient work
- keyboard-driven responses for approvals, choices, and forms
- text replies through the inline input row where supported
- one-line operator-facing judgment copy
- `why` inspection mode with routed-vs-surfaced state

## What The TUI Does Not Try To Be

It is not:

- a chat transcript
- a dashboard of every metric
- a source-specific UI
- the place where source-native semantics live

It is a calm attention surface above the shared judgment engine.

## Demo

Run the mixed-source TUI demo:

```bash
pnpm demo:tui
```

## Related Docs

- [System Architecture Diagram](./system-architecture-diagram.md)
- [Architecture Principles](./architecture-principles.md)
- [TUI Design](./tui-design.md)
