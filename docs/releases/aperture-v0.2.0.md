# Aperture v0.2.0

`@tomismeta/aperture@0.2.0` is a product release that ships the hardened
judgment substrate, clearer operator language, and the cleaned-up surfaced lane
model.

## Highlights

- bundles `@tomismeta/aperture-core@0.5.0`
- updates the surfaced lane language to:
  - `now`
  - `next`
  - `ambient`
- improves why mode and trace copy so the TUI better distinguishes:
  - routed facts
  - context-only semantics
  - source vs inferred provenance
- cleans up runtime capture/export naming so recorded artifacts use the same
  contract vocabulary as the live product
- keeps cross-adapter semantic behavior more consistent across Claude Code,
  OpenCode, and Codex

## Why This Matters

This is the biggest product-shape cleanup since the initial package cut.

The product should now feel:

- calmer
- more coherent
- easier to inspect
- more internally consistent from SDK to runtime to TUI

In practice that means:

- cleaner now/next/ambient framing in the live surface
- better why-mode explanations
- better trace fidelity from host adapters
- more polished exported captures and replay artifacts

## What Did Not Change

This release does **not** change the basic Aperture product shape:

- install `@tomismeta/aperture`
- run `aperture`
- connect supported agent surfaces
- work from one calm attention surface

It also does **not** add broader cloud or marketplace behavior. The product is
still the local attention surface built on the deterministic judgment core.

## Validation

Validated with:

```bash
pnpm typecheck
pnpm --dir packages/aperture run smoke
pnpm release:check
```

## Install

```bash
npm install -g @tomismeta/aperture
aperture
```

See:

- [Product README](../../packages/aperture/README.md)
- [Aperture v0.1.2](./aperture-v0.1.2.md)
- [Architecture Overview](../product/architecture-overview.md)
