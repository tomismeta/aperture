# Aperture Core SDK v0.4.1

`@tomismeta/aperture-core@0.4.1` is a small SDK polish release.

This patch keeps the `0.4.0` judgment engine and public package shape intact,
while tightening the SDK contract around host-aware integrations.

## Highlights

- exports `AttentionSurfaceCapabilities` and related capability types from the
  root SDK package
- clarifies the difference between:
  - host constraints
  - explicit operator profile
  - learned operator behavior
- tightens npm-facing SDK wording so the package reads more clearly as the
  deterministic judgment engine inside Aperture
- keeps the root SDK loop small and stable:
  - `event in -> frame/view out -> human response in`

## Why This Matters

SDK consumers can always adapt their host outside core.

But if a host never tells Aperture what it can actually render or accept, core
will still plan as if it is targeting the richer default surface.

This release makes that host-capability seam more explicit without expanding the
SDK into host-specific integrations.

That is especially useful for:

- conversational terminal hosts
- chat or plugin surfaces
- speech-first or audio-friendly interfaces
- any embedded host that is more constrained than the default TUI

## What Did Not Change

This is not a routing or learning-behavior release.

It does **not** change:

- the deterministic judgment path
- default planning semantics
- learning persistence behavior
- the semantic subpath contract

## Validation

Validated with:

```bash
pnpm exec tsx --test packages/core/test/public-sdk.test.ts
pnpm typecheck
npm pack --dry-run
```

## Install

```bash
npm install @tomismeta/aperture-core
```

See:

- [Core README](../../packages/core/README.md)
- [SDK Path](../product/sdk-path.md)
- [Host Surface Expansion Note](../roadmap/host-surface-expansion-note.md)
- [Aperture Core SDK v0.4.0](./aperture-core-v0.4.0.md)
