# Aperture Core SDK v0.2.2

`@tomismeta/aperture-core@0.2.2` is a hardening release.

This patch does not change Aperture's product story or public shape.
It makes the current engine more correct, more legible, and less fragile.

## Highlights

- hardened the adapter/core seam so routing-critical behavior prefers explicit semantics over loose title-text inference
- tightened route-vs-surface invariants and trace visibility across the engine and TUI
- improved Claude and OpenCode golden-scenario coverage around passive status, question, and completion paths
- fixed pressure/posture cooling so burst activity no longer leaves the system stuck in a busy state after work goes quiet
- removed the abandoned Paperclip adapter path from the repo
- refreshed the docs surface and archived stale implementation plans/specs

## Why This Matters

The main goal of this release was confidence.

Aperture's hot path is still deterministic, but it now relies less on accidental wording and more on explicit source facts in the places that matter most:

- policy
- value
- continuity
- committed surfaced state

That means passive status and similar low-signal work are less likely to drift into the wrong route because of incidental text.

## Pressure / Posture Fix

This release also fixes a real product issue where the TUI posture could stay at `busy` after a rapid burst even when nothing was actively happening anymore.

The core pressure and burden calculations now cool stale signal bursts in live use while still respecting currently visible interruptive work.

## Validation

Validated before release with:

```bash
pnpm typecheck
pnpm test
```

Result:

- `269` tests passing
