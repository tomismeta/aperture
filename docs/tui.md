# TUI Surface

`@aperture/tui` is an optional terminal-native surface for [`@tomismeta/aperture-core`](../packages/core/src/index.ts).

It does not know about Paperclip, Codex, Claude Code, or any other source. It only consumes core contracts:

- `AttentionView`
- `AttentionFrame`
- `AttentionResponse`

## How to Read the TUI

The screen is divided into three sections. Read them top to bottom:

### ACTIVE NOW

The one thing Aperture thinks you should look at first. This is the decision surface — if something needs your input, it appears here.

The active frame shows:

- **Title** — what is happening, in plain language (e.g., "Approve deployment", "Build failed")
- **Source** — where it came from (e.g., "Claude Code", "Codex", "Paperclip")
- **Mode** — what kind of interaction this is:
  - `permission` — you can approve or reject
  - `choose` — pick an option
  - `input needed` — fill in fields
  - `update` — informational, sometimes acknowledge-only
- **Urgency** — shown as one of:
  - `low urgency` — background awareness
  - `needs attention` — worth looking at
  - `urgent` — strongest urgency, should cut through
- **Risk** — shown as one of: `low risk`, `medium risk`, `high risk`
- **Summary / context** — details about the request (file paths, commands, working directory)
- **Score** — hidden by default. Press `[space]` to reveal. A relative ranking number — higher means "more likely to deserve focus." Computed from blocking-ness, priority, consequence, tone, and heuristic adjustments. Useful for debugging, not for operating.

### QUEUE

Important items waiting behind the active frame. These are ranked by score. When the active frame is resolved, the top queued item promotes to active.

### AMBIENT

Awareness-only items. Background status updates, completed tasks, low-priority notifications. These should not interrupt you.

## What Do I Do?

Look at the **controls line** at the bottom of the screen. It is the source of truth for what actions are available:

| Controls shown | What it means |
| --- | --- |
| `[a] approve  [r] reject  [x] dismiss` | A real approval/permission decision. Read the title and context, then decide. |
| `[enter] acknowledge` | An informational status update. Acknowledge to clear it. |
| `[1-9] choose` | A choice request. Pick an option by number. |
| `[i] input` | A form. Press `i` to start typing. |
| `[space] detail` | Toggle expanded context and rationale. |
| `[q] quit` | Exit the TUI. |

### The simplest operator rule

1. Read the title
2. Check the mode
3. Read the summary/context
4. Use the controls line to act

### What am I approving?

Approval frames are actions that a source wants to take and is asking for your sign-off. What that means depends on the adapter:

- **Claude Code** — tool permission requests (file reads, shell commands, edits, searches)
- **Codex** — task execution approvals
- **Paperclip** — deployment or action confirmations

Approving lets the source proceed. Rejecting blocks the action. Dismissing defers the decision back to the source's own prompt.

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

## Design direction

For the intended layout and attention principles behind the TUI, see [TUI Design](./tui-design.md).

For the next implementation pass that adds judgment-legible operator copy and a
`why` inspection mode, see [TUI Redesign Spec](./tui-redesign-spec.md).
