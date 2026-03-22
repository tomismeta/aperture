# Package Splitting Decision

This document records the current package-splitting decisions for Aperture.

The goal is to avoid accidental drift between:

- the monorepo decomposition
- the public npm surface
- the product entrypoint
- the release bar for `@tomismeta/aperture-core`

## Core Decision

Aperture should have **two public surfaces** and a stricter separation between
workspace layout and npm layout.

### Public surface 1: advanced SDK

- package: `@tomismeta/aperture-core`
- purpose: deterministic engine embedding
- audience: advanced builders and host integrators

### Public surface 2: product package

- package: scoped `aperture` product package
- current workspace shape: [packages/aperture](/Users/tom/dev/aperture/packages/aperture)
- purpose: local-first product entrypoint with the `aperture` command
- audience: operators and teams adopting Aperture as a product

Everything else should remain internal until there is clear external demand.

## Public Package Split

### What should be public now

1. `@tomismeta/aperture-core`
2. the future official `aperture` product package

### What should stay internal for now

- `@aperture/runtime`
- `@aperture/tui`
- `@aperture/claude-code`
- `@aperture/opencode`
- `@aperture/codex`
- `@aperture/lab`

These may remain workspace packages, but they should not be treated as stable
external contracts yet.

## `aperture-core` Surface Decision

The root SDK should remain ruthless.

### Root package should expose

- the core event/frame/response loop
- `ApertureCore`
- the canonical public event contracts

### Root package should not expose

- runtime boot
- TUI concerns
- adapter setup
- internal engine modules as a casual API

### Advanced escape hatch

- `@tomismeta/aperture-core/semantic`

That subpath exists intentionally for advanced semantic inspection and
normalization, but it should remain clearly secondary to the root package.

## `aperture-core` Dist Decision

The **public contract should match the shipped tarball more closely** before the
next release.

Today, `exports` are correct, but the tarball still includes the broader module
graph under `dist/`.

That is acceptable for internal dogfooding, but not ideal for the next external
release.

### Required tightening before the next core publish

`@tomismeta/aperture-core` should ship only the entrypoints we intentionally
support:

- `dist/index.js`
- `dist/index.d.ts`
- `dist/semantic.js`
- `dist/semantic.d.ts`

Plus package metadata and docs:

- `package.json`
- `README.md`
- `LICENSE`

### Why this matters

Even with correct `exports`, shipping the entire internal graph:

- makes the package feel less intentional
- invites deep-import experimentation
- makes future internal refactors feel riskier than they should
- weakens the ruthless public-surface story

### Decision

Before publishing `@tomismeta/aperture-core@0.4.0`, tighten the build or pack
step so the tarball contains only supported entrypoints.

## Product Package Decision

The product package should be the **official adoption path**, not a thin alias
for repo scripts.

### Product package should own

- launcher
- runtime boot
- TUI boot
- first-run setup
- Claude hook setup
- OpenCode setup
- built-in session capture

### Product package should not require users to know

- internal workspace package names
- repo-only scripts
- manual runtime wiring

## Product Packaging Decision

The workspace package at [packages/aperture](/Users/tom/dev/aperture/packages/aperture)
is now the correct boundary, but it is **not yet ready to publish**.

### Why it is not yet publishable

It still depends on internal workspace packages that are not public npm
artifacts.

### Decision

Before publishing the product package, choose one of these strategies
explicitly:

1. **Bundle the internal product stack into the product package**
   - preferred default
   - keeps the public story simple
   - avoids prematurely publishing many internal packages

2. **Publish a small set of supporting packages**
   - only if real external composability demand appears
   - higher maintenance cost
   - weaker initial product simplicity

Current recommendation: **bundle first, split later only if demand proves it**.

## Release Ordering Decision

### Next core release

Hold `@tomismeta/aperture-core@0.4.0` until:

1. hardening changes are committed
2. validation stays green
3. `dist` is tightened to supported entrypoints only

### Product package release

Hold the product package launch until:

1. the package is independently publishable
2. first-run setup is product-facing
3. `aperture` works without repo-specific assumptions
4. capture and diagnostics feel like product features, not internal tooling

## Working Rule

From here on:

- **workspace decomposition is for implementation**
- **public package decomposition is for adoption**

Those should not be assumed to be the same thing.
