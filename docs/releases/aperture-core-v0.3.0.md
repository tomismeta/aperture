# Aperture Core SDK v0.3.0

`@tomismeta/aperture-core@0.3.0` is a feature release.

This release adds a deterministic semantic interpretation layer to source-event
ingestion, strengthens semantic and continuity benchmarking in Aperture Lab, and
shrinks the public SDK root to the minimal supported surface.

## Highlights

- added a built-in deterministic semantic layer for `SourceEvent` ingestion
- centralized semantic detection, semantic language, and relation semantics in core
- extended continuity with relation-aware signals like same-issue, repeats, resolves, and supersedes
- added semantic, adversarial, and perturbation-backed JudgmentBench coverage in Aperture Lab
- tightened the root npm API so consumers stay on the primary SDK loop instead of coupling to internal judgment primitives
- preserved downstream compatibility for adapters, runtime, TUI, and the Paperclip plugin

## Why This Matters

This release moves Aperture closer to the product claim we want to defend:

- deterministic judgment
- deterministic semantic interpretation in the hot path
- explicit, bounded normalization before routing
- a smaller and more intentional SDK surface

The engine is still the same core product:

`event in -> frame/view out -> response in`

What changed is that `SourceEvent` handling is now more capable and the package
surface is less permissive about internal engine plumbing.

## Public SDK Shape

The root package now intentionally exposes only:

- `ApertureCore`
- core event and source-event types
- frame, task-view, view, response, and signal types
- semantic interpretation types
- core listener and options types

It no longer exposes the internal judgment primitives or helper utilities from
the root package surface.

## Merge Checklist

- [ ] confirm branch is `codex/core-lab-semantic-layer`
- [ ] review the current diff and release note for accuracy
- [ ] verify the root SDK surface in [packages/core/src/index.ts](../../packages/core/src/index.ts)
- [ ] confirm `paperclip-aperture` still compiles and tests cleanly against the intended surface
- [ ] run:

```bash
pnpm typecheck
pnpm test
pnpm judgment:bench
pnpm judgment:fuzz
```

- [ ] commit the final branch state
- [ ] merge into `main`

## Publish Checklist

- [ ] on `main`, verify [packages/core/package.json](../../packages/core/package.json) is at `0.3.0`
- [ ] rebuild and pack:

```bash
pnpm --filter @tomismeta/aperture-core build
cd packages/core
pnpm pack
```

- [ ] inspect the tarball contents and confirm the root export surface matches the release intent
- [ ] publish:

```bash
cd packages/core
npm publish --access public
```

## Post-Publish Checks

- [ ] verify the npm page shows `0.3.0`
- [ ] install the published package into a clean temp project and confirm the minimal SDK loop compiles
- [ ] confirm `paperclip-aperture` still typechecks against the published package
- [ ] update any repo-level release references if needed

## Validation Status On Branch

Validated on `codex/core-lab-semantic-layer` with:

```bash
pnpm typecheck
pnpm exec tsx --test packages/core/test/public-sdk.test.ts packages/lab/test/**/*.test.ts packages/tui/test/**/*.test.ts packages/runtime/test/**/*.test.ts
pnpm judgment:bench
pnpm judgment:fuzz
```

Additional compatibility validation:

- `paperclip-aperture` `pnpm typecheck`
- `paperclip-aperture` `pnpm test`
- temporary compile against a packed tarball of the current branch using the Paperclip-used SDK symbols
