# `@aperture/core`

Deterministic, self-tuning attention judgment for agent systems.

`@aperture/core` is the SDK substrate behind Aperture. It contains the judgment engine, the learning loop, and the stable types needed to embed Aperture inside another runtime without depending on the local host or TUI.

It is not:

- a transport server
- a terminal UI
- a source-specific adapter
- a generic agent orchestration framework

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
- `evaluateTraceSession`
  - replay and evaluation helper

The key public schemas are:

- `ApertureEvent`
- `ConformedEvent`
- `AttentionCandidate`
- `AttentionFrame`
- `AttentionResponse`
- `AttentionSignal`
- `MemoryProfile`
- `JudgmentConfig`
- `ApertureTrace`

The SDK uses the explicit `Attention*` naming family intentionally. Earlier generic names like `Frame` or `FrameResponse` are not part of the public contract.

## Proving The SDK Outside The Monorepo

This repo includes two package-facing examples:

- `examples/core-full-engine`
- `examples/core-judgment-primitives`

And one verification command:

```bash
pnpm sdk:prove
```

That command:

- builds `@aperture/core`
- packs it into a tarball
- installs it into temporary consumer projects
- runs both examples outside monorepo import assumptions

## Integration Modes

### Full Engine Mode

Use `ApertureCore` when you want Aperture to own the attention model end to end.

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

const attentionView = core.getAttentionView();
```

### Judgment Primitive Mode

Use the judgment primitives when you already have your own runtime and only want Aperture’s attention adjudication.

```ts
import {
  AttentionPlanner,
  AttentionPolicy,
  AttentionValue,
  JudgmentCoordinator,
  type AttentionCandidate,
} from "@aperture/core";

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

## Learning Persistence

The learning loop is part of the package, not just the host runtime:

`signals -> memory -> value -> planner -> presentation -> response -> new signals`

That means SDK consumers can:

- let `ApertureCore` accumulate signals
- distill learned state with `distillMemoryProfile`
- persist it with `ProfileStore`
- keep persistence entirely optional

## Design Principles

`@aperture/core` is intended to stay:

- small-footprint
- zero-runtime-dependency
- deterministic in the hot path
- inspectable in its judgment
- adapter-agnostic

If the package becomes harder to explain than the product, the surface is too wide.
