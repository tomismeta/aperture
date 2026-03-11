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

Use the runtime + TUI + Claude adapter when you want Aperture to manage a live Claude workload.

1. Write Claude hooks:

```bash
pnpm setup:claude-hook --global
```

Or per project:

```bash
pnpm setup:claude-hook /path/to/project
```

2. Start the shared Aperture runtime:

```bash
pnpm claude:serve
```

3. In another terminal, attach the TUI:

```bash
pnpm claude:tui
```

If you want successful tool completions too:

```bash
pnpm setup:claude-hook --global --include-post-tool-use
APERTURE_INCLUDE_POST_TOOL_USE=1 pnpm claude:serve
```

Then restart Claude Code and run `/hooks` to confirm the hook set loaded.

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
