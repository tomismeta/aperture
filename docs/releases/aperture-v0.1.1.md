# Aperture v0.1.1

`@tomismeta/aperture@0.1.1` is a production-behavior patch release for the
first public Aperture product package.

## Production Behavior Fixes

This patch keeps the original `0.1.0` product shape and install flow intact,
while tightening the real installed experience:

- smooths SSH rendering so the surface no longer flashes or glitches while idle
- restores the idle lens pulse on setup and quiet live screens without forcing
  full-screen repaints
- keeps OpenCode setup guidance visible until the server is truly ready, then
  preserves the server URL and `opencode attach ...` command in the ready state
- upgrades Claude setup detection so an already-working bridge is shown as
  `ready`, with the actual hook URL called out
- lets `show setup` reopen the setup surface during quiet live moments without
  crowding `now` or `next`
- hardens the built CLI artifact so the installed npm binary remains directly
  executable

## Everything From v0.1.0 Still Applies

`0.1.1` is still the same product release line introduced in `0.1.0`:

- plain `npm install -g @tomismeta/aperture`
- plain `aperture`
- local-first CLI/TUI product
- one product-owned attention surface for approvals, follow-ups, failures, and
  blocked work

If you are installing Aperture for the first time, start here:

```bash
npm install -g @tomismeta/aperture
aperture
```

If you use Claude Code, Aperture prepares Claude on first launch. Restart
Claude Code after the first run and confirm `/hooks` loaded.

If you want OpenCode, run:

```bash
opencode serve --port 4096
opencode attach http://127.0.0.1:4096
aperture
```

## Product Shape

This package is still the product, not a library surface.

Use `@tomismeta/aperture` when you want:

- the installed CLI/TUI experience
- one shared attention surface for agent work that needs you
- local setup, troubleshooting, and uninstall flows

Use `@tomismeta/aperture-core` when you want the underlying deterministic
judgment engine as an SDK.

## Why This Matters

The core product loop is still:

`agent events in -> attention surface out -> human response back`

`0.1.1` makes that loop behave better in the real world, especially for:

- SSH sessions
- clean-box installs
- existing Claude bridges
- OpenCode server-and-attach setup

## Validation

Validated with:

```bash
pnpm typecheck
pnpm exec tsx --test packages/aperture/test/connection-status.test.ts packages/tui/test/tui-render.test.ts packages/tui/test/interaction.test.ts
pnpm --dir packages/aperture run smoke
```

## Install

```bash
npm install -g @tomismeta/aperture
aperture
```

See:

- [Product README](../../packages/aperture/README.md)
- [Aperture v0.1.0](./aperture-v0.1.0.md)
- [Architecture Overview](../product/architecture-overview.md)
- [TUI Surface](../product/tui.md)
