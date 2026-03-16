# Aperture Technical Product Roadmap

This document tracks the technical productization work that sits beside the
engine roadmap.

The product roadmap answers:

- what Aperture should become
- where the moat deepens
- what the next macro product moves are

This document answers:

- how mature the live adapter paths are
- how healthy the shared runtime/TUI product path is
- how the published core SDK should evolve from here

## Current State

Right now Aperture has:

- a published core SDK:
  - `@tomismeta/aperture-core@0.2.1`
- two live adapter paths:
  - Claude Code
  - OpenCode
- one shared local runtime
- one shared TUI
- a recently completed hardening phase focused on:
  - explicit semantics before judgment
  - bounded fallback heuristics
  - route-vs-surface invariants
  - golden host scenarios

The immediate technical priority is not breadth. It is confidence:

- confidence in the live adapter paths
- confidence in the published SDK surface
- confidence in replayable deterministic behavior

## The Three Tracks

There are still three parallel technical tracks:

1. adapter maturity
2. SDK/package maturity
3. engine maturity for embed and multi-surface use

They should influence each other, but they do not have to move in lockstep.

## Adapter Maturity

### Claude Code

Status: `live, close to hardened`

What is true today:

- live end-to-end hook path
- approval / hold / timeout behavior
- follow-up and passive-status handling
- explicit semantics for high-value passive and interactive paths
- strong regression coverage

This remains the flagship live path.

### OpenCode

Status: `live`

What is true today:

- live end-to-end server + terminal flow
- Aperture-side connection profile setup
- permissions, structured questions, blocked awareness, and session-status paths
- shared runtime + shared TUI alongside Claude Code
- explicit semantics threaded through the high-value paths

What is still weaker than Claude:

- less battle-tested
- more host-surface variance
- desktop/macOS behavior is still less proven than the server/terminal path

### Codex

Status: `boundary only`

What is true today:

- semantic mapping boundary exists
- package boundary exists

What is not true yet:

- no live transport path
- no end-to-end product flow

## SDK / Package Maturity

### Current State

Status: `published`

What is true today:

- `ApertureCore` is a real integration surface
- lower-level judgment primitives are available
- the learning loop is part of the package story
- examples and external-consumer proof paths exist
- release notes and npm-facing docs are live

### What Matters Now

The SDK question is no longer:

- can Aperture be published?

It is now:

- how do we keep the published surface honest as the engine evolves?

That means:

- keep the README and npm-facing docs accurate
- keep examples healthy
- avoid expanding the public surface casually
- support external consumers based on actual friction, not guesswork

## Engine Maturity For Embed And Multi-Surface Use

Status: `strong foundation, next stage defined`

What is true today:

- the deterministic loop is coherent:
  - policy
  - value
  - planning
  - continuity
  - presentation
  - response
- the hardening phase materially reduced routing-critical fragility
- explicit semantics now dominate the critical paths
- traces can explain both routed and surfaced outcomes

What is still next, not done:

- explicit ambiguity handling
- stronger attention-surface capability modeling
- broader replay/eval tooling
- more mature host-level validation outside the shared TUI

For the engine ordering, see:

- [Engine Roadmap](./engine-roadmap.md)
- [Core Maturation Plan](./core-maturation-plan.md)
- [Architecture Principles](./architecture-principles.md)

## Recommended Near-Term Sequence

Ordered by leverage:

1. **Keep Claude Code healthy as the flagship path**
   - it should remain the easiest obvious success path

2. **Keep OpenCode healthy as the second live path**
   - it pressure-tests the shared runtime and TUI with a source Aperture does not control

3. **Build replay / evaluation as a first-class loop**
   - compare routing behavior
   - review disagreements
   - tune thresholds offline

4. **Support the published package deliberately**
   - keep examples healthy
   - keep npm/GitHub docs honest
   - harden based on real consumer friction

5. **Prove one non-TUI host surface later**
   - only after the evaluation loop is more mature

## What To Avoid

- adding new adapters just to broaden the source list
- widening the public SDK surface casually
- moving tuning or learning into the hot path
- letting host-specific convenience leak into core judgment semantics

The right bias now is:

- keep the live paths trustworthy
- keep the published package honest
- deepen confidence before broadening scope
