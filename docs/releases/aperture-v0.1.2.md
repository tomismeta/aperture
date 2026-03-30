# Aperture v0.1.2

`@tomismeta/aperture@0.1.2` is a product patch release that ships the updated
core semantic behavior inside the public Aperture product package.

## Highlights

- bundles the stronger `aperture-core` semantic interpretation from
  `0.4.2`
- improves how the shipped product handles imported observational failures and
  reduces false escalation in real agent traces
- benefits from the hardened F-Stop unattended pre-release loop that now runs
  against unseen evaluation lanes before package cuts

## Why This Matters

`@tomismeta/aperture` is the installable product, not just an SDK wrapper.

Even when the product package itself does not add new top-level commands in a
patch, rebuilding it with a better judgment core matters because users feel the
result directly in:

- calmer interruption behavior
- more accurate consequence reads
- better trace explanation

## What Did Not Change

This is still the same product line introduced in `0.1.0`.

It does **not** change the basic product shape:

- install `@tomismeta/aperture`
- run `aperture`
- connect supported agent surfaces
- work from one calm attention surface

## Validation

Validated with:

```bash
pnpm typecheck
pnpm --dir packages/aperture run smoke
pnpm release:check
```

The pre-release F-Stop sweep also completed before this cut, with:

- `swe-smith/xml` completing as `no_proposal`
- `open-agent-sessions/approved` exhausting cleanly instead of ending as a
  misleading blocked lane

## Install

```bash
npm install -g @tomismeta/aperture
aperture
```

See:

- [Product README](../../packages/aperture/README.md)
- [Aperture v0.1.1](./aperture-v0.1.1.md)
- [Architecture Overview](../product/architecture-overview.md)
