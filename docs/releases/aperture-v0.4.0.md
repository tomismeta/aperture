# Aperture v0.4.0

`@tomismeta/aperture@0.4.0` is a product hardening release that matures the
local runtime, hardens the host-neutral ingress path, and improves shared
operator review across supported agent surfaces.

## Highlights

- bundles `@tomismeta/aperture-core@0.7.0`
- hardens the local `/work` ingress that landed in `0.3.0`:
  - TypeBox-backed contract as the single source of truth
  - generated schemas and schema validation checks
  - fuzz coverage for `WorkEvent` ingress
  - bounded and persisted work-response storage
  - authenticated runtime routes plus route telemetry
- splits the runtime into cleaner route, state, validation, and work modules
- improves review fidelity across adapters:
  - richer Claude Code runtime context
  - better OpenCode choice and multi-select preservation
  - Codex MCP elicitation support
- improves the live operator loop:
  - cleaner source labels
  - better multi-select response handling in the TUI
  - stronger explanation and session-review capture paths

## Why This Matters

This release makes Aperture a stronger shared review surface across hosts while
preserving the small local product shape.

In practice that means:

- external work can enter the running product through a cleaner, better-tested
  contract
- the runtime is more inspectable and bounded under real use
- human-input requests from different hosts arrive with higher fidelity and are
  easier to answer from one place

The product stance stays intentional:

- Aperture is still the local attention product first
- `/work` is still an optional integration seam
- host-neutral review and control stay more important than mimicking any one
  host runtime

## What Did Not Change

This release does **not** turn Aperture into a cloud service or a generic
orchestration framework.

It still does **not** add:

- a public `/runtime/*` product contract
- webhooks as the default response model
- a separate published runtime package
- a Copilot/GitHub adapter in the shipped product

The product is still:

- install `@tomismeta/aperture`
- run `aperture`
- connect supported agent surfaces
- work from one calm shared attention surface

## Validation

Validated with:

```bash
pnpm typecheck
pnpm sdk:prove
pnpm product:smoke
pnpm release:check
```

## Install

```bash
npm install -g @tomismeta/aperture
aperture
```

See:

- [Product README](../../packages/aperture/README.md)
- [Host-Neutral Ingestion Contract](../product/host-neutral-ingestion-contract.md)
- [Aperture v0.3.0](./aperture-v0.3.0.md)
