# Aperture

Aperture is the human attention engine for agent systems.

LLMs spend model tokens. Operators spend attention tokens.

A small TypeScript library that decides what deserves human attention now, what should wait, and what can remain ambient.

It is not:
- an orchestrator
- a protocol
- a renderer
- a dashboard

## Two Ways To Use It

### 1. Embed `@aperture/core`

Use Aperture as a small library inside your own app or service when you already control the event source and just want attention judgment.

You publish `ApertureEvent` or `ConformedEvent` values and consume `AttentionView`.

### 2. Run Aperture For Claude Code

Use the shared Aperture runtime plus the TUI and Claude adapter when you want Aperture to manage live Claude Code approvals, failures, and follow-up handoff.

This gives you:
- a long-lived local Aperture runtime
- a terminal attention surface
- Claude Code hook ingestion into the shared runtime

## Why

If you are supervising multiple agents, everything can interrupt at once:
- approvals
- failures
- blocked work
- status noise

Aperture exists to answer three questions:
- what deserves attention now
- what should queue behind it
- what should stay ambient

## Footprint

- `@aperture/core`: standalone library
- `@aperture/runtime`: shared local host for `ApertureCore`, adapters, and surfaces
- `@aperture/claude-code`, `@aperture/paperclip`, `@aperture/codex`: optional source adapters
- `@aperture/tui`: optional attention surface

Adapters emit `ConformedEvent`s into the runtime. `@aperture/core` normalizes semantics and decides what should be active, queued, or ambient. Surfaces subscribe to the runtime.

## Quickstart

### Library Use

Install and use `@aperture/core` when you want rating/attention judgment in your own code.

```bash
pnpm install
pnpm test
pnpm typecheck
```

Use core directly when you already control the event source:

```ts
import { ApertureCore, type ApertureEvent } from "@aperture/core";

const core = new ApertureCore();

core.publish({
  id: "evt:approval",
  taskId: "task:deploy",
  timestamp: new Date().toISOString(),
  type: "human.input.requested",
  interactionId: "interaction:deploy:review",
  title: "Approve production deploy",
  summary: "A production deploy is waiting for review.",
  request: { kind: "approval" },
});
```

If your source already emits factual source events, publish `ConformedEvent` instead:

```ts
import { ApertureCore } from "@aperture/core";
import { mapPaperclipLiveEvent } from "@aperture/paperclip";

const core = new ApertureCore();

for (const event of mapPaperclipLiveEvent(liveEvent)) {
  core.publishConformed(event);
}
```

### Claude Code Use

Use Aperture to manage live Claude Code approvals, failures, and follow-up handoff.

Most people only need one setup command and one daily command.

One-time setup:

```bash
pnpm claude:connect --global
```

Project-local setup instead:

```bash
pnpm claude:connect /path/to/project
```

Daily use:

```bash
pnpm aperture
```

After connecting Claude for the first time, restart Claude Code and run `/hooks` once to confirm the hook set loaded.

To remove Aperture's Claude hook config later:

```bash
pnpm claude:disconnect --global
```

## Command Reference

These are the commands that matter for local use.

| Command | What it does | When to use it |
| --- | --- | --- |
| `pnpm aperture` | Starts the default local Aperture stack. | Use this for normal day-to-day local use. It starts the runtime, Claude adapter, and TUI together. |
| `pnpm serve` | Starts the shared Aperture runtime. | Use this when you want the runtime without automatically starting any surface or adapter. |
| `pnpm tui` | Starts the terminal UI and attaches it to a live Aperture runtime. | Use this to view and respond to work in the runtime. |
| `pnpm claude:connect --global` | Writes Aperture's Claude config into `~/.claude/settings.json`. | Use this once to connect Claude Code across all projects. |
| `pnpm claude:connect /path/to/project` | Writes Aperture's Claude config into `.claude/settings.local.json` for one project. | Use this when you only want Claude connected in one repo. |
| `pnpm claude:start` | Starts the Claude Code adapter process and connects it to a live Aperture runtime. | Use this when you want to run the Claude adapter separately from the default `pnpm aperture` stack. |
| `pnpm claude:disconnect --global` | Removes only Aperture's Claude hook entries from `~/.claude/settings.json`. | Use this to uninstall the global Claude integration. |
| `pnpm claude:disconnect /path/to/project` | Removes only Aperture's Claude hook entries from `.claude/settings.local.json` in one project. | Use this to uninstall the project-local Claude integration. |

Manual and development commands:

| Command | What it does |
| --- | --- |
| `pnpm demo:tui` | Runs the standalone demo renderer with sample data. |
| `pnpm build` | Builds the TypeScript packages. |
| `pnpm test` | Runs the test suite. |
| `pnpm typecheck` | Runs TypeScript project checks. |
| `pnpm clean` | Removes built package output. |

If you are using Aperture with Claude Code day to day, the normal flow is:

```bash
pnpm claude:connect --global
pnpm aperture
```

## Today

- deterministic attention judgment
- behavioral signals, trends, and recency-bounded summaries
- shared runtime host for adapters and surfaces
- Claude Code, Codex, and Paperclip adapters
- a source-agnostic TUI surface

## Feedback

Helpful feedback right now:
- traces where the engine made the wrong call
- reports from real multi-agent supervision workloads
- new adapters for additional event sources
- tighter return-path mappings for existing adapters

## Docs

- [Components](docs/components.md)
- [Semantic Normalization](docs/semantic-normalization.md)
- [TUI Surface](docs/tui.md)
- [Claude Code Adapter](docs/claude-code.md)
- [Paperclip Adapter](docs/paperclip.md)
- [Codex Adapter](docs/codex.md)
