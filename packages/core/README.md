# Aperture Core SDK

Deterministic, self-tuning attention judgment for agent systems.

Published on npm as `@tomismeta/aperture-core`.

Use this when multiple agent events compete for limited human attention and you need deterministic, inspectable prioritization.

The Aperture core SDK is for runtimes that need to decide what deserves human attention now, what should wait, and what can stay in the background as agent activity competes for limited human focus.

The Aperture core SDK is the SDK substrate behind Aperture. It contains the judgment engine, the optional learning and persistence loop, and the stable types needed to embed Aperture inside another runtime without depending on the local host or TUI.

This package is ESM-only and requires Node.js 18+.

It is not:

- a transport server
- a terminal UI
- a source-specific adapter
- a generic agent orchestration framework

## Start Here

Most consumers only need four things:

- `ApertureCore`
- `ApertureEvent`
- `AttentionFrame`
- `AttentionResponse`

The recommended loop is:

1. create `ApertureCore`
2. publish an `ApertureEvent` with `core.publish(...)`
3. if you get back an `AttentionFrame`, show it or route it to your UI
4. when the human responds, call `core.submit(...)`

Use `SourceEvent` and `core.publishSourceEvent(...)` only when you are building an adapter from source-native events and want Aperture to normalize them first.

## Quickstart

```ts
import { ApertureCore, type ApertureEvent } from "@tomismeta/aperture-core";

const core = new ApertureCore();

const event: ApertureEvent = {
  id: "evt:approval",
  taskId: "task:deploy",
  timestamp: new Date().toISOString(),
  type: "human.input.requested",
  interactionId: "interaction:deploy:review",
  title: "Approve production deploy",
  summary: "A production deploy is waiting for review.",
  request: { kind: "approval" },
};

const frame = core.publish(event);

if (frame) {
  console.log(frame.title);
  console.log(frame.mode);

  core.submit({
    taskId: frame.taskId,
    interactionId: frame.interactionId,
    response: { kind: "approved" },
  });
}
```

If you want the whole current surface after each event, call `core.getAttentionView()`.

## Choose Your Input Type

### Recommended: `ApertureEvent`

Use `ApertureEvent` when your runtime can already express:

- task lifecycle updates
- human input requests
- consequence, tone, and context when you know them

This is the easiest integration path and the one most new consumers should start with.

### Advanced: `SourceEvent`

Use `SourceEvent` when you are mapping source-native facts into Aperture and want the SDK to normalize them into `ApertureEvent` internally.

This is mainly for adapter authors.

## What It Exposes

The public surface is centered on a few core concepts:

- `ApertureCore`
  - the full engine facade
- `AttentionPolicy`
  - deterministic guardrails and approval rules
- `AttentionValue`
  - adaptive value-of-attention scoring
- `AttentionPlanner`
  - queue and presentation planning
- `JudgmentCoordinator`
  - composition of policy, value, pressure, and planning
- `distillMemoryProfile`
  - learned memory distillation
- `ProfileStore`
  - optional local persistence helper
- `forecastAttentionPressure`
  - predictive overload signal
- `idleAttentionPressure`
  - zero-load pressure baseline for hosts that want an explicit idle state
- `scoreAttentionFrame`
  - frame scoring helper for diagnostics and replay tooling
- `evaluateTraceSession`
  - replay and evaluation helper

The key public schemas are:

- `ApertureEvent`
- `SourceEvent`
- `AttentionCandidate`
- `AttentionFrame`
- `AttentionResponse`
- `AttentionSignal`
- `MemoryProfile`
- `JudgmentConfig`
- `ApertureTrace`
- subscription listener types for frames, task views, signals, responses, and traces

The SDK uses the explicit `Attention*` naming family intentionally. Earlier generic names like `Frame` or `FrameResponse` are not part of the public contract.

## Repo Verification

This section is for repo maintainers, not package consumers.

This repo includes two package-facing examples:

- `examples/core-full-engine`
- `examples/core-judgment-primitives`

And one verification command:

```bash
pnpm sdk:prove
```

That command:

- builds the Aperture core SDK package
- packs it into a tarball
- installs it into temporary consumer projects
- runs both examples outside monorepo import assumptions

## Integration Modes

### Full Engine Mode

Use `ApertureCore` when you want Aperture to own the attention model end to end.

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

const attentionView = core.getAttentionView();
```

`publish()` returns the newly materialized `AttentionFrame` when work enters the surface, or `null` when an event is normalized into a no-op or clear action.

If you are starting from raw source-native events instead, use `core.publishSourceEvent(...)` with `SourceEvent`.

### Judgment Primitive Mode

Use the judgment primitives when you already have your own runtime and only want Aperture’s attention adjudication.

```ts
import {
  AttentionPlanner,
  AttentionPolicy,
  AttentionValue,
  JudgmentCoordinator,
  type AttentionCandidate,
} from "@tomismeta/aperture-core";

const coordinator = new JudgmentCoordinator(
  new AttentionPolicy(),
  new AttentionValue(),
  new AttentionPlanner(),
);

const candidate: AttentionCandidate = {
  taskId: "task:review",
  interactionId: "interaction:review",
  mode: "approval",
  tone: "focused",
  consequence: "medium",
  title: "Review file write",
  responseSpec: {
    kind: "approval",
    actions: [
      { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
      { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
    ],
  },
  priority: "high",
  blocking: true,
  timestamp: new Date().toISOString(),
};

const decision = coordinator.coordinate(null, candidate);
```

If you want the full rationale instead of just the final decision, call `coordinator.explain(...)`.

## Learning Persistence

The learning loop is part of the package, not just the host runtime:

`signals -> memory -> value -> planner -> presentation -> response -> new signals`

That means SDK consumers can:

- let `ApertureCore` accumulate signals
- distill learned state with `distillMemoryProfile`
- persist it with `ProfileStore`
- keep persistence entirely optional

## Design Principles

The Aperture core SDK is intended to stay:

- small-footprint
- zero-runtime-dependency
- deterministic in the hot path
- inspectable in its judgment
- adapter-agnostic

If the package becomes harder to explain than the product, the surface is too wide.
