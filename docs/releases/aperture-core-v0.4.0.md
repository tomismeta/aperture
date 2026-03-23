# Aperture Core SDK v0.4.0

`@tomismeta/aperture-core@0.4.0` is the release where the SDK surface becomes
intentional, slimmer, and easier to trust.

This cut tightens the published package shape, hardens ingestion and replay
paths, and makes the supported external contract much clearer.

## Highlights

- ships a slim public tarball with an intentional export surface
- keeps the root SDK loop small and stable
- exposes the advanced semantic seam at `@tomismeta/aperture-core/semantic`
- hardens scenario, session-bundle, and runtime-side validation
- removes deterministic-path footguns around implicit wall-clock behavior
- preserves the repo-internal runtime, TUI, and lab architecture without
  leaking that complexity into the published package

## Public SDK Shape

The supported npm entrypoints are:

- `@tomismeta/aperture-core`
- `@tomismeta/aperture-core/semantic`

The root package stays focused on the main loop:

`event in -> frame/view out -> human response in`

Use the semantic subpath only when you are building advanced adapters or want
to invoke Aperture's deterministic source-event interpretation directly.

## Why This Matters

This release is about trust, not feature count.

It means:

- the npm package now better matches the API we intend to support
- consumers do not have to depend on internal engine modules accidentally
- artifact loading and replay tooling are harder to misuse
- the SDK story is clearer for external builders using Aperture outside the repo

## Validation

Validated with:

```bash
pnpm typecheck
pnpm test
pnpm judgment:bench
pnpm judgment:fuzz
pnpm sdk:prove
```

## Install

```bash
npm install @tomismeta/aperture-core
```

See:

- [Core README](../../packages/core/README.md)
- [SDK Path](../product/sdk-path.md)
- [Architecture Overview](../product/architecture-overview.md)
