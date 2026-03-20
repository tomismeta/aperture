<div align="center">

# Aperture

**The human attention control plane for agent systems.**

[![npm core](https://img.shields.io/npm/v/%40tomismeta%2Faperture-core?label=npm%20core&color=0f766e)](https://www.npmjs.com/package/@tomismeta/aperture-core)
[![license](https://img.shields.io/badge/license-MIT-6f42c1)](./LICENSE)
[![docs](https://img.shields.io/badge/docs-architecture%20overview-475569)](./docs/product/architecture-overview.md)


<img src="docs/assets/demo.gif" alt="Aperture demo" width="1100">
<p></p>
</div>


Aperture sits between many agent event sources and one human decision surface. It decides what deserves attention now, what should wait until next, and what should stay ambient.

```text
+-----------+    +-------------+    +-------------+    +-------------+    +-------------+
|  Arrive   | -> |  Translate  | -> |    Judge    | -> |    Show     | -> |   Respond   |
|  events   |    |    facts    |    |  attention  |    |   surface   |    |   action    |
+-----------+    +-------------+    +-------------+    +-------------+    +-------------+

tool hooks       explicit facts      does this         what the          operator decision
from coding      from raw payloads   deserve           operator          carried back
agents                               attention now?    actually sees     to the tool
```

## Start Here

Choose one path:

- **use the SDK** if you want to embed Aperture's judgment engine in your own runtime or UI
- **run the local stack** if you want one shared Aperture runtime and TUI supervising live source adapters on this machine

### Use The SDK

**Package:** `@tomismeta/aperture-core`

```bash
npm install @tomismeta/aperture-core
```

The SDK loop is intentionally small:

`ApertureEvent in via core.publish(...) or SourceEvent in via core.publishSourceEvent(...) -> AttentionFrame / AttentionView out -> AttentionResponse in`

See [packages/core/README.md](packages/core/README.md).

### Run The Local Stack

```bash
git clone git@github.com:tomismeta/aperture.git
cd aperture
pnpm install
```

Then connect at least one live source path:

```bash
pnpm claude:connect --global
```

or

```bash
pnpm opencode:connect --global --url http://127.0.0.1:4096
```

Then start Aperture:

```bash
pnpm aperture
```

This starts:

- Aperture runtime
- configured source adapters
- terminal attention surface

## What Aperture Is

Aperture is a judgment engine for human attention in agent systems.

Aperture takes events from tools and agents, turns them into explicit facts, and decides what deserves attention now, what should wait until next, and what should remain ambient.

The goal is simple: give one human a calm, deterministic way to supervise many parallel agent workflows.

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

## Judgment Doctrine

Aperture is governed by a simple idea:

**Aperture protects your attention in a world designed to abuse it.**

That means:

- interruption is a scarce semantic resource
- the engine should surface decisions, not raw events
- next and ambient modes help preserve the meaning of interruption
- low-confidence cases should stay peripheral instead of stealing focus
- the human attention loop should be deterministic, inspectable, and behaviorally grounded

The full doctrine lives in [docs/engine/attention-judgment-doctrine.md](docs/engine/attention-judgment-doctrine.md).

## Current Product Shape

What is real on `main` today:

- the Aperture core SDK (`@tomismeta/aperture-core`) is the judgment engine
- `@aperture/runtime` hosts one live shared core for adapters and surfaces
- `@aperture/tui` is the terminal-native attention surface
- `@aperture/claude-code` is the current end-to-end live adapter path
- `@aperture/opencode` is a working live adapter path for OpenCode server and terminal sessions
- the Aperture core SDK now includes a built-in deterministic semantic layer for `SourceEvent` ingestion
- the default runtime uses local learning persistence through `.aperture/MEMORY.md` and a scaffolded `.aperture/JUDGMENT.md`
- `USER.md`, `MEMORY.md`, and `JUDGMENT.md` remain the broader core judgment-state model, even though `MEMORY.md` and `JUDGMENT.md` are the live default local surfaces today

What the engine already does:

- normalize source events into one shared attention model
- interpret bounded semantics before normalization when the source sends `SourceEvent`s
- separate hard policy from adaptive utility and next-step planning
- learn from response latency, context expansion, deferral, and disagreement
- keep related work continuous through episode modeling
- suppress lower-value work before overload
- explain decisions through score components, planner rationale, and replay traces
- validate judgment changes through Aperture Lab with golden, adversarial, and perturbation-backed scenarios

What the SDK intentionally does **not** expose at the root:

- lower-level judgment primitives like policy, value, planner, or coordinator classes
- semantic helper internals
- trace, pressure, or persistence helpers intended for repo-internal use

The supported npm consumer story stays small:

`event in -> frame/view out -> response in`

## Live Source Paths

Aperture's current full-stack story is one shared runtime and one shared TUI with multiple live source adapters feeding it.

Today, the two first-class source paths are:

- **Claude Code**
  - connection model: Aperture writes Claude hook config, then Claude posts hook payloads into the shared runtime
  - supported shape: local Claude Code sessions with the Aperture hook path enabled
- **OpenCode**
  - connection model: Aperture stores an OpenCode server profile, then connects to `opencode serve` as an external attention plane
  - supported shape: OpenCode server plus terminal attach flow

Both can feed the same TUI at once.

## Full-Stack Quickstarts

### Claude Code

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

That starts the shared local Aperture stack with the Claude path enabled:

- shared runtime
- Claude Code adapter
- terminal attention surface
- local learning persistence in `.aperture/MEMORY.md`
- scaffolded local judgment defaults in `.aperture/JUDGMENT.md`

Use `pnpm aperture --learning off` if you want an ephemeral session with no local learning persistence.

### OpenCode

```bash
git clone git@github.com:tomismeta/aperture.git
cd aperture
pnpm install
opencode serve --port 4096
```

In another terminal:

```bash
pnpm opencode:connect --global --url http://127.0.0.1:4096
pnpm aperture
```

Then:

1. if you want OpenCode's terminal UI on the same server, use `opencode attach http://127.0.0.1:4096`
2. use the shared Aperture TUI to supervise OpenCode, or OpenCode and Claude Code together

## Supported Capabilities

### Claude Code

What Aperture currently supports for Claude Code:

- tool-aware permission frames from hook payloads
- post-tool failure awareness
- non-blocking completion awareness
- waiting / input-needed awareness
- follow-up handoff when Claude ends a turn with a real question
- one shared runtime and one shared TUI across Claude Code and OpenCode
- connection management via:
  - `pnpm claude:connect --global`
  - `pnpm claude:disconnect --global`

### OpenCode

What Aperture currently supports for OpenCode:

- permission approvals from the OpenCode server / terminal path
- structured `question.asked` prompts from the OpenCode server / terminal path
- lightweight awareness when OpenCode is blocked waiting for a human reply
- one shared runtime and one shared TUI across Claude Code and OpenCode
- connection profiles via:
  - `pnpm opencode:connect --global`
  - `pnpm opencode:disconnect --global`

### Supported Operator Story

The supported live path today is:

- Claude Code with Aperture hook config enabled
- OpenCode via `opencode serve` and `opencode attach`
- `pnpm aperture` as the shared runtime + TUI entrypoint

### Current Limitations

Claude Code:

- transport is hook-shaped, so the connection step remains Claude-specific
- transcript-level or lifecycle-level understanding is still narrower than the hook surface

OpenCode:

- the native OpenCode macOS desktop app does not yet reliably surface all human gates through the same server-visible event path Aperture consumes
- generic freeform text entry in the Aperture TUI is not implemented yet, so OpenCode questions that implicitly allow custom typed answers are only partially represented today

## Connection Model

Today, source connections are owned by the source-specific scripts and the shared runtime, not by the TUI.

That is intentional:

- the TUI stays source-agnostic
- Claude Code and OpenCode each need different connection/setup semantics
- runtime startup and adapter liveness stay outside the presentation layer

The TUI may eventually become a nicer place to inspect or launch connections, but it should still remain a surface attached to the shared runtime rather than becoming the owner of source-specific transports.

`JUDGMENT.md` is a small human-owned config template. The accepted live values today are:

- rule names: `lowRiskRead`, `lowRiskWeb`, `fileWrite`, `envWrite`, `destructiveBash`
- rule fields: `auto approve`, `may interrupt`, `minimum presentation`, `require context expansion`
- ambiguity defaults: `non blocking activation threshold`, `promotion margin`
- planner defaults:
  - `batch status bursts`
  - `defer low value during pressure`
  - `minimum dwell ms`
  - `stream continuity margin`
  - `conflicting interrupt margin`
  - `disabled continuity rules`

If a category still requires a human response to proceed, keep it `active`. Use `auto approve` only for bounded approval categories you want Aperture to resolve immediately and deterministically.

In the default scaffold:

- `lowRiskRead`, `lowRiskWeb`, and `fileWrite` stay active for explicit human approval
- `envWrite` and `destructiveBash` stay active and require context expansion
- ratchet categories down to `auto approve` only when you explicitly want bounded pass-through

The hot path behind those settings now reads as:

`evidence -> policy gates -> evaluation -> policy criterion -> routing -> continuity -> frame -> feedback`

That structure is intentional: Aperture exposes a few human-owned controls, keeps the rest deterministic in code, and makes the resulting judgment path inspectable through traces instead of hiding it inside opaque heuristics.

## Two Ways To Use It

### 1. Run Aperture As A Shared Local Stack

Use the shared runtime, one or more adapters, and the TUI when you want a working local attention surface for live approvals, failures, and follow-up handoff.

This is the main product path today.

### 2. Embed The Aperture Core SDK

Use the core engine directly when you already control the event source and want attention judgment inside your own app or service.

Install it from npm as `@tomismeta/aperture-core`:

```bash
npm install @tomismeta/aperture-core
```

The recommended SDK loop is:

- publish an `ApertureEvent`
- get back an `AttentionFrame` if it should enter the human attention surface
- render that frame in your UI or workflow layer
- submit the human answer back into Aperture

In other words:

`event in -> frame out -> human answer in -> state updates`

Start with `ApertureEvent` for most integrations. Use `SourceEvent` only when you are building an adapter from source-native events and want Aperture to normalize them first.

For the full package-facing SDK docs, see [packages/core/README.md](packages/core/README.md).

## Architecture

- Aperture core SDK (`@tomismeta/aperture-core`): deterministic judgment engine
- `@aperture/runtime`: shared local host for one live `ApertureCore`
- `@aperture/claude-code`, `@aperture/opencode`: live source adapters
- `@aperture/tui`: source-agnostic terminal surface

For the full architectural overview, including the napkin, event sequence, and
detailed system diagrams, see [Architecture Overview](docs/product/architecture-overview.md).

## Using Core Directly

The Aperture core SDK is now published on npm as `@tomismeta/aperture-core` for embeddable judgment use.

If you already own the event stream, start with `ApertureEvent` and `core.publish(...)`:

```ts
import { ApertureCore } from "@tomismeta/aperture-core";

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

If your integration is building an adapter from source-native facts, publish `SourceEvent` instead:

```ts
import { ApertureCore, type SourceEvent } from "@tomismeta/aperture-core";

const core = new ApertureCore();

const sourceEvents: SourceEvent[] = [
  {
    id: "src:approval",
    source: {
      system: "custom-runtime",
      label: "Custom Runtime",
    },
    task: {
      id: "task:deploy",
      title: "Deploy review",
    },
    interaction: {
      id: "interaction:deploy:review",
    },
    occurredAt: new Date().toISOString(),
    event: {
      type: "human.input.requested",
      title: "Approve production deploy",
      summary: "A deployment is waiting for review.",
      request: { kind: "approval" },
    },
  },
];

for (const event of sourceEvents) {
  core.publishSourceEvent(event);
}
```

## Commands

### Day-to-day

| Command | What it does |
| --- | --- |
| `pnpm aperture` | Starts the default local Aperture stack: runtime, any configured Claude/OpenCode adapters, TUI, local learning persistence in `.aperture/MEMORY.md`, and scaffolded judgment config in `.aperture/JUDGMENT.md`. |
| `pnpm aperture --learning off` | Starts the default local stack without local learning persistence. |
| `pnpm claude:connect --global` | Connects Claude Code globally by writing Aperture hook config into `~/.claude/settings.json`. |
| `pnpm claude:disconnect --global` | Removes Aperture's Claude hook entries from `~/.claude/settings.json`. |
| `pnpm opencode:connect --global` | Saves a global Aperture-side OpenCode connection profile in `~/.aperture/opencode.json`. |
| `pnpm opencode:disconnect --global` | Removes an Aperture-side OpenCode connection profile from `~/.aperture/opencode.json`. |

### Manual / advanced

| Command | What it does |
| --- | --- |
| `pnpm serve` | Starts the shared Aperture runtime only. |
| `pnpm tui` | Starts the terminal UI and attaches it to a live runtime. |
| `pnpm claude:start` | Starts the Claude Code adapter separately from the default stack. |
| `pnpm opencode:start` | Starts the OpenCode adapter(s) for the saved Aperture-side OpenCode connection profiles. |
| `pnpm claude:connect /path/to/project` | Connects Claude Code only for one project via `.claude/settings.local.json`. |
| `pnpm claude:disconnect /path/to/project` | Removes the project-local Claude hook config. |

### Development

| Command | What it does |
| --- | --- |
| `pnpm test` | Runs the full test suite. |
| `pnpm typecheck` | Runs TypeScript project checks. |
| `pnpm build` | Builds the TypeScript packages. |
| `pnpm demo:tui` | Runs the standalone demo renderer with sample data. |
| `pnpm demo:record` | Regenerates `docs/assets/demo.gif` and `docs/assets/demo.mp4` with a scripted Claude Code + OpenCode capture. Requires `vhs`. |
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
- live OpenCode server / terminal integration

## What Is Not Mature Yet

- desktop-grade OpenCode parity outside the server / terminal path
- evaluator-driven tuning loops
- stale episode lifecycle
- richer anticipation behavior
- advisory model-based reasoning

## Reading The TUI

The TUI has three sections:

- **NOW**: what deserves your attention right now
- **NEXT**: what is waiting behind it
- **AMBIENT**: awareness-only items that should not interrupt

For the full guide, see [How to Read the TUI](docs/product/tui.md#how-to-read-the-tui).

## Docs

Start here:

- [Docs Index](docs/README.md)
- [Architecture Overview](docs/product/architecture-overview.md)
- [Components](docs/product/components.md)
- [Adapter Contract](docs/product/adapter-contract.md)
- [TUI Surface](docs/product/tui.md)
- [Claude Code Adapter](docs/adapters/claude-code-adapter.md)
- [OpenCode Adapter](docs/adapters/opencode-adapter.md)

Reference docs:

- [Semantic Normalization](docs/engine/semantic-normalization.md)
- [Interaction Signals](docs/engine/interaction-signals.md)
- [Frame](docs/engine/frame.md)

## Feedback

Helpful feedback right now:

- traces where the engine made the wrong call
- reports from real multi-agent supervision workflows
- examples of missing anticipation behavior
- tighter ingress/egress paths for existing adapters
