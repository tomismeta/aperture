# Aperture Technical Product Roadmap

This document tracks the productization work that sits alongside the core product roadmap.

The product roadmap answers:

- what Aperture should become
- where the moat deepens
- what the next macro product moves are

This technical roadmap answers:

- how mature each adapter path is
- how close the Aperture core SDK package is to becoming a real SDK
- what should happen before npm publishing

The goal is to improve distribution and maturity without diluting the product.

## Two Parallel Tracks

There are two technical productization tracks:

1. adapter maturity
2. core package and SDK readiness

They should move in parallel, but they do not need to move at the same speed.

Right now, the SDK path is closer than broad adapter maturity.

## Current Read

### Adapter Maturity

#### Claude Code

Status: `live`

What is true today:

- live end-to-end integration path
- hook-based connection flow
- approval/hold/timeout behavior
- strong test coverage
- default product path in the README

This is the flagship path.

#### Paperclip

Status: `partial`

What is true today:

- mapping layer exists
- client/transport helpers exist
- integration boundary is real

What is not true yet:

- not a polished live default path
- not documented as a production-grade integration
- not hardened to the same level as Claude Code

#### Codex

Status: `boundary only`

What is true today:

- semantic mapping layer exists
- package boundary is in place

What is not true yet:

- no live transport path
- no end-to-end product flow

### Core / SDK Readiness

#### Architecture

Status: `strong`

What is true today:

- the real judgment layer lives in the Aperture core SDK package (`@tomismeta/aperture-core`)
- the judgment vocabulary is coherent
- the learning loop lives in core, not just runtime glue
- the main judgment primitives are exported
- the product and SDK stories are now aligned

#### Package Surface

Status: `published`

What is true today:

- `ApertureCore` is a plausible full-engine integration surface
- lower-level judgment primitives are available
- learning persistence is part of the core model
- the SDK path is documented
- external consumers can install a packed tarball and run both full-engine and judgment-primitive examples
- package metadata and tarball contents are now curated for first release
- `@tomismeta/aperture-core@0.1.0` is published on npm

## The Maturity Ladder

### Adapter Ladder

The adapter track should move through four levels:

1. `mapped`
2. `transported`
3. `live`
4. `hardened`

Definitions:

- `mapped`
  - source events translate cleanly into Aperture contracts

- `transported`
  - there is a working live transport path

- `live`
  - the path is documented and usable end to end

- `hardened`
  - the path is tested, reliable, and worth foregrounding in the product

Current placement:

- Claude Code: `live`, close to `hardened`
- Paperclip: between `mapped` and `transported`
- Codex: `mapped`

### SDK Ladder

The SDK track should move through five levels:

1. `SDK-aware`
2. `SDK-proving`
3. `SDK-hardened`
4. `SDK-ready`
5. `published`

Definitions:

- `SDK-aware`
  - the architecture is exportable and the naming is coherent

- `SDK-proving`
  - an external consumer can use the package outside the monorepo

- `SDK-hardened`
  - the public contract is intentionally small and explicitly documented

- `SDK-ready`
  - packaging, metadata, examples, tarball hygiene, and install flows are ready for first release

- `published`
  - the package is actually on npm and being used as a substrate

Current placement:

- the Aperture core SDK package: `published`

The next target is adoption and iteration.

## What SDK-Ready Should Mean

Before and through npm publishing, Aperture should prove the core package in one small external integration and keep tightening the artifact itself.

That should mean:

- create a tiny consumer outside the workspace
- install or pack the Aperture core SDK package
- exercise `ApertureCore` in full-engine mode
- exercise at least one lower-level judgment primitive path
- verify the learning loop still works outside the built-in runtime
- keep the tarball limited to the published contract

This is the right step because it reveals real API friction and packaging sloppiness before we make a public compatibility promise.

## Publish Gates For The Aperture Core SDK

These were the gates for the first publish:

1. the exported API is intentionally narrow and documented
2. one external consumer has already exercised the package successfully
3. package metadata and README make sense without repo context
4. the learning loop still works in embedded usage
5. internal implementation modules are not leaking as accidental public contract
6. the tarball only contains the published package surface

That keeps publishing as a packaging milestone, not a speculative branding move.

## Recommended Near-Term Sequence

Ordered by leverage:

1. **Keep Claude Code as the flagship live adapter**
   - keep one path obviously working while the substrate matures

2. **Choose the second real source**
   - Paperclip or Codex, based on actual demand and access

3. **Keep package-facing examples healthy**
   - one full-engine example
   - one judgment-primitive example

4. **Support the published package deliberately**
   - tag releases cleanly
   - keep the README and npm-facing docs honest
   - harden based on real consumer friction

## What To Avoid

To keep the productization path clean:

- do not publish the Aperture core SDK package before an external consumer proves the surface
- do not widen the public API just because internal modules exist
- do not let package ergonomics pull attention away from the judgment product
- do not treat Codex or Paperclip parity as a prerequisite for SDK work

## Recommendation

If we have limited time and limited live adapter demand, the best technical productization move is:

**support the Aperture core SDK package as a published SDK while keeping the judgment engine itself moving**

That is the closest, most controllable maturity step:

- it does not depend on external platform hooks
- it makes the substrate more real
- it supports the long-term embed story
- it keeps the project moving while adapter availability is uneven
