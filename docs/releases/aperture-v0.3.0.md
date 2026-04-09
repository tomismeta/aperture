# Aperture v0.3.0

`@tomismeta/aperture@0.3.0` is a product release that tightens the live
operator loop and adds a cleaner optional ingress path for external work,
without making the shipped product heavier.

## Highlights

- bundles `@tomismeta/aperture-core@0.6.0`
- adds a cleaner local `/work` ingress path with progressive sophistication:
  - plain text
  - minimal structured `WorkEvent`
  - `WorkEvent[]` batch
- adds a public response loop for structured human-input requests:
  - `GET /work/response/{interactionId}`
- preserves engaged operator focus more deliberately in the live surface
- bounds ambient retention so long-running product state stays cleaner
- clarifies the product-vs-SDK split in the docs and package entrypoints

## Why This Matters

This release improves both sides of the product loop:

- the operator experience is calmer while real work is in flight
- the product is easier to integrate with when another tool needs to report
  work into a running Aperture instance

The important balance is intentional:

- Aperture is still the local attention product first
- `/work` is an optional integration seam, not the whole product story

## What Did Not Change

This release does **not** broaden the public product surface casually.

It does **not** add:

- a public `/runtime/*` API contract
- a shipped `aperture demo` command
- a separate published runtime package
- webhook or cloud complexity

The product is still:

- install `@tomismeta/aperture`
- run `aperture`
- connect supported agent surfaces
- work from one calm attention surface

## Validation

Validated with:

```bash
pnpm typecheck
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
- [Aperture v0.2.1](./aperture-v0.2.1.md)
