# Contributing

This repo is still early and engine-first.

The bar for contributions is simple:

- keep `@tomismeta/aperture-core` small
- do not couple source-specific logic into core
- prefer deterministic, testable behavior over speculative abstraction
- keep adapter logic thin and reversible

The most valuable contributions are grounded in real multi-agent human attention workloads.

If you use Aperture, please try it against:

- multiple agent sources competing for attention
- approval-heavy workflows
- failure + blocked-task mixes
- noisy status streams where low-value work should stay ambient

The goal is not just to make the code pass. The goal is to pressure-test whether the engine is actually making good attention decisions.

Additional adapters are welcome.

Good adapter contributions:

- preserve the `ApertureEvent -> ApertureCore -> FrameResponse` boundary cleanly
- keep source-specific transport and mapping outside `@tomismeta/aperture-core`
- make ingress and egress both explicit when the upstream system supports them

## Development

Install dependencies:

```bash
pnpm install
```

Run the main checks:

```bash
pnpm test
pnpm typecheck
```

Run the companion surface:

```bash
pnpm demo:tui
```

## Scope Discipline

Before adding code, ask:

- does this strengthen the attention engine?
- does this belong in an adapter instead of core?
- can this be expressed with fewer public constructs?

Good contributions:

- better deterministic judgment
- better signal quality
- better tests around attention behavior
- thin ingress or egress adapters
- real-world workload reports and scenario traces
- clearer docs and examples

Bad contributions:

- source-specific conditionals inside core
- broad UI framework work not tied to the engine
- speculative anticipation layers without real signal grounding
- unnecessary new public abstractions
