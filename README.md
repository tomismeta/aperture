# Aperture

Aperture is the human attention engine for agent systems.

LLMs spend model tokens. Operators spend attention tokens.

A small TypeScript library that decides what deserves human attention now, what should wait, and what can remain ambient.

It is not:
- an orchestrator
- a protocol
- a renderer
- a dashboard

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
- `@aperture/claude-code`, `@aperture/paperclip`, `@aperture/codex`: optional source adapters
- `@aperture/tui`: optional attention surface

Adapters emit `ConformedEvent`s. `@aperture/core` normalizes semantics and decides what should be active, queued, or ambient.

## Quickstart

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm demo:tui
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

Use an adapter when you want Aperture to sit between an upstream system and the human loop:

```ts
import { ApertureCore } from "@aperture/core";
import { mapPaperclipLiveEvent } from "@aperture/paperclip";

const core = new ApertureCore();

for (const event of mapPaperclipLiveEvent(liveEvent)) {
  core.publishConformed(event);
}
```

## Today

- deterministic attention judgment
- behavioral signals, trends, and recency-bounded summaries
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
