# Aperture v0.1.0

`@tomismeta/aperture@0.1.0` is the first public release of the Aperture
product package.

It packages Aperture as a real installed CLI/TUI product: local-first,
installable with npm, runnable from anywhere, and ready to connect live agent
surfaces like Claude Code and OpenCode.

## Highlights

- ships Aperture as a CLI-first product package
- launches the local attention surface with `aperture`
- includes first-run setup for Claude Code
- supports OpenCode through the local server-and-attach flow
- adds `doctor`, `debug`, `completion`, and `uninstall`
- keeps product-owned state under `~/.aperture`
- supports replayable troubleshooting captures

## Product Shape

This package is the product, not a library surface.

Use `@tomismeta/aperture` when you want:

- the installed CLI/TUI experience
- one shared attention surface for agent work that needs you
- local setup, troubleshooting, and uninstall flows

Use `@tomismeta/aperture-core` when you want the underlying deterministic
judgment engine as an SDK.

## Why This Matters

This release makes Aperture feel real:

- plain `npm install -g @tomismeta/aperture`
- plain `aperture`
- no monorepo required
- one product-owned surface for approvals, follow-ups, failures, and blocked work

The core product loop is:

`agent events in -> attention surface out -> human response back`

## Validation

Validated with:

```bash
pnpm typecheck
pnpm release:check
pnpm product:smoke
```

## Install

```bash
npm install -g @tomismeta/aperture
aperture
```

See:

- [Product README](../../packages/aperture/README.md)
- [Architecture Overview](../product/architecture-overview.md)
- [TUI Surface](../product/tui.md)
