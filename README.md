# Aperture

Aperture is a human attention engine for agent systems.

It sits between many possible event sources and one human decision surface, then decides:

- what deserves attention now
- what should wait in the queue
- what should remain ambient

Today, the main live path is:

- Claude Code -> Aperture runtime -> terminal attention surface

Under the hood, Aperture already includes:

- deterministic policy, utility, and planning layers
- behavioral signals and memory-backed judgment
- episode-aware coordination across related work
- pressure forecasting before overload
- replay evaluation for judgment behavior

## What Aperture Is

Aperture is an engine-first TypeScript workspace for protecting human attention in agent-heavy workflows.

It is not:

- an orchestrator
- a chat UI
- a dashboard
- a generic queue
- an LLM call wrapped around approval prompts

The core bet is simple:

**human attention should be allocated by a fast, deterministic, inspectable engine that gets better with use**

## Why It Exists

When you supervise multiple agents, everything can interrupt at once:

- tool approvals
- failures
- blocked work
- follow-up questions
- status noise

The hard problem is not moving events around.

The hard problem is deciding how human attention should be spent.

Aperture exists to answer that in the hot path, without turning every judgment into a slow or expensive model call.

## Current Product Shape

What is real on `main` today:

- `@aperture/core` is the judgment engine
- `@aperture/runtime` hosts one live shared core for adapters and surfaces
- `@aperture/tui` is the terminal-native attention surface
- `@aperture/claude-code` is the current end-to-end live adapter path
- `@aperture/codex` and `@aperture/paperclip` provide mapping layers today, with different transport maturity
- `USER.md`, `MEMORY.md`, and `JUDGMENT.md` provide human-readable durable judgment state

What the engine already does:

- normalize source events into one shared attention model
- separate hard policy from adaptive utility and queue planning
- learn from response latency, context expansion, deferral, and disagreement
- keep related work continuous through episode modeling
- suppress lower-value work before overload
- explain decisions through score components, planner rationale, and replay traces

## Quickstart

This is the recommended path if you want Aperture managing Claude Code on this machine.

```bash
git clone git@github.com:tomismeta/aperture.git
cd aperture
pnpm install
pnpm claude:connect --global
pnpm aperture
```

Then:

1. restart Claude Code
2. run `/hooks` once inside Claude Code
3. use Claude normally

That starts the default local Aperture stack:

- shared runtime
- Claude Code adapter
- terminal attention surface

## Two Ways To Use It

### 1. Run Aperture With Claude Code

Use the shared runtime, Claude adapter, and TUI when you want a working local attention surface for live approvals, failures, and follow-up handoff.

This is the main product path today.

### 2. Embed `@aperture/core`

Use the core engine directly when you already control the event source and want attention judgment inside your own app or service.

You publish `ApertureEvent` or `ConformedEvent` values and consume `AttentionView`.

## Architecture

- `@aperture/core`: deterministic judgment engine
- `@aperture/runtime`: shared local host for one live `ApertureCore`
- `@aperture/claude-code`, `@aperture/codex`, `@aperture/paperclip`: source adapters
- `@aperture/tui`: source-agnostic terminal surface

The flow is:

`source event -> adapter -> conformed event -> core judgment -> attention surface -> human response -> new signals`

## Using Core Directly

If you already own the source event stream, you can use `@aperture/core` directly:

```ts
import { ApertureCore } from "@aperture/core";

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

console.log(core.getAttentionView());
```

If your adapter already emits factual source events, publish `ConformedEvent` instead:

```ts
import { ApertureCore } from "@aperture/core";
import { mapPaperclipLiveEvent } from "@aperture/paperclip";

const core = new ApertureCore();

for (const event of mapPaperclipLiveEvent(liveEvent)) {
  core.publishConformed(event);
}
```

## Commands

### Day-to-day

| Command | What it does |
| --- | --- |
| `pnpm aperture` | Starts the default local Aperture stack: runtime, Claude adapter, and TUI. |
| `pnpm claude:connect --global` | Connects Claude Code globally by writing Aperture hook config into `~/.claude/settings.json`. |
| `pnpm claude:disconnect --global` | Removes Aperture's Claude hook entries from `~/.claude/settings.json`. |

### Manual / advanced

| Command | What it does |
| --- | --- |
| `pnpm serve` | Starts the shared Aperture runtime only. |
| `pnpm tui` | Starts the terminal UI and attaches it to a live runtime. |
| `pnpm claude:start` | Starts the Claude Code adapter separately from the default stack. |
| `pnpm claude:connect /path/to/project` | Connects Claude Code only for one project via `.claude/settings.local.json`. |
| `pnpm claude:disconnect /path/to/project` | Removes the project-local Claude hook config. |

### Development

| Command | What it does |
| --- | --- |
| `pnpm test` | Runs the full test suite. |
| `pnpm typecheck` | Runs TypeScript project checks. |
| `pnpm build` | Builds the TypeScript packages. |
| `pnpm demo:tui` | Runs the standalone demo renderer with sample data. |
| `pnpm clean` | Removes built package output. |

## What Is Built Today

- deterministic judgment with inspectable policy, utility, and planner outputs
- behavioral signals, trend summaries, and durable markdown-backed judgment state
- consequence calibration and human-specific memory
- episode batching, merge heuristics, and actionability
- predictive pressure handling
- replay evaluation foundation
- shared local runtime and source-agnostic TUI
- live Claude Code integration

## What Is Not Mature Yet

- live transports beyond Claude Code
- evaluator-driven tuning loops
- stale episode lifecycle
- richer anticipation behavior
- advisory model-based reasoning

## Reading The TUI

The TUI has three sections:

- **ACTIVE NOW**: the one thing Aperture thinks the human should look at first
- **QUEUE**: important items waiting behind the active frame
- **AMBIENT**: awareness-only items that should not interrupt

For the full guide, see [How to Read the TUI](docs/tui.md#how-to-read-the-tui).

## Docs

Start here:

- [Components](docs/components.md)
- [Engine Roadmap](docs/engine-roadmap.md)
- [TUI Surface](docs/tui.md)
- [Claude Code Adapter](docs/claude-code.md)

Reference docs:

- [Semantic Normalization](docs/semantic-normalization.md)
- [Interaction Signals](docs/interaction-signals.md)
- [Codex Adapter](docs/codex.md)
- [Paperclip Adapter](docs/paperclip.md)
- [Frame](docs/frame.md)

## Feedback

Helpful feedback right now:

- traces where the engine made the wrong call
- reports from real multi-agent supervision workflows
- examples of missing anticipation behavior
- tighter ingress/egress paths for existing adapters
