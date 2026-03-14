# Aperture Technical Product Roadmap

This document tracks the productization work that sits alongside the core product roadmap.

The product roadmap answers:

- what Aperture should become
- where the moat deepens
- what the next macro product moves are

This technical roadmap answers:

- how mature each adapter path is
- how close the Aperture core SDK package is to becoming a real SDK
- what should happen before and after npm publishing

The goal is to improve distribution and maturity without diluting the product.

## Three Parallel Tracks

There are three technical productization tracks:

1. adapter maturity
2. core package and SDK readiness
3. core engine maturation for embed and multi-surface use

They should move in parallel, but they do not need to move at the same speed.

Right now:

- the SDK path is already published
- the next adapter proving ground is likely Paperclip
- the next core-engine maturity work should be explicit ambiguity handling

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
- `@tomismeta/aperture-core@0.1.1` is published on npm

Namespace note:

- the package is published as `@tomismeta/aperture-core` because the `@aperture` npm scope was not available at first release
- the product and architecture language remain "Aperture" and "Aperture Core"
- a future scope migration is possible without changing the underlying product thesis

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

### Core Engine Maturation

#### Status

Status: `defined, not yet implemented`

What is true today:

- the judgment core is already strong enough to publish and embed
- the loop is coherent: policy -> value -> planning -> presentation -> response
- the engine already learns from signals over time

What is not true yet:

- ambiguity is not yet a first-class explicit policy seam
- attention surface capabilities are not yet strongly explicit planner inputs
- named attention profiles do not yet exist as a first-class product concept
- mode-shaping side signals are not yet deliberately modeled

## What SDK-Ready Meant Before Publishing

Before the first npm publish, Aperture needed to prove the core package in one small external integration and keep tightening the artifact itself.

That should mean:

- create a tiny consumer outside the workspace
- install or pack the Aperture core SDK package
- exercise `ApertureCore` in full-engine mode
- exercise at least one lower-level judgment primitive path
- verify the learning loop still works outside the built-in runtime
- keep the tarball limited to the published contract

This was the right step because it revealed real API friction and packaging sloppiness before making a public compatibility promise.

## Publish Gates We Used For The First SDK Release

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

2. **Prove one second real surface**
   - Paperclip is the strongest current candidate because it can validate both the adapter seam and the SDK surface

3. **Tighten the core engine where integrations will pressure it**
   - explicit ambiguity handling first
   - attention surface capabilities second
   - attention profiles later
   - mode-shaping side signals last

4. **Keep package-facing examples healthy**
   - one full-engine example
   - one judgment-primitive example

5. **Support the published package deliberately**
   - tag releases cleanly
   - keep the README and npm-facing docs honest
   - harden based on real consumer friction

For the engine-maturation ordering, see [Core Maturation Plan](./core-maturation-plan.md).

## What To Avoid

To keep the productization path clean:

- do not widen the public API just because internal modules exist
- do not let package ergonomics pull attention away from the judgment product
- do not treat Codex or Paperclip parity as a prerequisite for SDK work
- do not treat publication as the end of the SDK work; the next phase is adoption and pressure-testing

## Recommendation

If we have limited time and limited live adapter demand, the best technical productization move is:

**support the published Aperture core SDK package while using one real integration to pressure-test the next core-engine maturity seams**

The best next sequence is:

1. keep Claude Code strong
2. use Paperclip as the likely second proving ground
3. implement explicit ambiguity handling before broader core expansions

That keeps the project moving without diluting the product or widening the engine prematurely.
