# Contributing

This repo is still early and engine-first.

The bar for contributions is simple:

- keep the Aperture core SDK package small
- do not couple source-specific logic into core
- prefer deterministic, testable behavior over speculative abstraction
- keep adapter logic thin and reversible
- treat Claude Code as the primary product path and Omarchy as a focused OMP channel

The most valuable contributions are grounded in real multi-agent human attention workloads.

If you use Aperture, please try it against:

- multiple agent sources competing for attention
- approval-heavy workflows
- failure + blocked-task mixes
- noisy status streams where low-value work should stay ambient

The goal is not just to make the code pass. The goal is to pressure-test whether the engine is actually making good attention decisions.

## Release and contract context

The latest published `@tomismeta/aperture` package is `0.5.0`; `main` is the
`0.10.0` release candidate. Do not infer a wire-contract version from either
package version.

The public surface protocol and private notification-worker output are distinct
exact-v4 contracts. Both hello frames carry `protocolVersion: 4`. Public surface
frames never carry navigation. Only private worker frames may carry the bounded
`{ kind: "opaque-focus", handle }` capability. The self-contained Omarchy
channel owns Core, state, and its canonical socket and must not acquire a
dependency on the Aperture CLI or runtime.

The private OMP manifest is independently `0.1.1`. BUILDINFO schema v2 records it
only at `integrations.omp.packageVersion`, pins
`artifactLimits.maximumTextArtifactBytes: 524288`, and records worker and OMP
extension byte sizes checked against that ceiling. Its `schemas` inventory is
the canonical protocol version/path/hash record; package versions and signed
release tags are independent identities.

Additional adapters are welcome.

Good adapter contributions:

- preserve the `ApertureEvent -> ApertureCore -> FrameResponse` boundary cleanly
- keep source-specific transport and mapping outside the Aperture core SDK package
- make ingress and egress both explicit when the upstream system supports them

## Development

Install dependencies:

```bash
pnpm install
```

Run the main checks:

```bash
pnpm boundary:check
pnpm test
pnpm typecheck
```

For a full release-shaped pass, run:

```bash
pnpm release:check
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
- refactors that preserve the public CLI and SDK behavior while reducing hidden coupling

Bad contributions:

- source-specific conditionals inside core
- broad UI framework work not tied to the engine
- speculative anticipation layers without real signal grounding
- unnecessary new public abstractions
- new non-test imports from `packages/*/src` into `packages/core/src/*` instead of using a supported contract
