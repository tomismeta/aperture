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
  - `@tomismeta/aperture-core@0.4.2`
- two live adapter paths:
  - Claude Code
  - OpenCode
- one experimental third adapter path:
  - Codex
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
- confidence that the engine behaves correctly across more than the flagship TUI

That confidence now includes the F-Stop pre-release loop:

- unattended replay and review before package cuts
- bounded offline optimizer attempts
- one final report for release readiness

The next release sequence should stay tight:

1. finish the current pre-release sweep
2. inspect only the highest-signal findings
3. merge only bounded, structural core improvements
4. cut the next `aperture-core` and `aperture` patch releases

The release bar should be:

- unattended sweeps ran reliably
- no new trustworthy core regressions surfaced
- any accepted semantic changes are structural, bounded, and well-tested

## The Three Tracks

There are still three parallel technical tracks:

1. adapter maturity
2. SDK/package maturity
3. engine maturity for embed and multi-surface use

They should influence each other, but they do not have to move in lockstep.

## Product Wedge

The wedge is getting clearer.

Aperture should not position itself as:

- another coding agent
- another agent runtime
- another eval dashboard
- another approval API

It should position itself as:

- the judgment and attention layer for agent work

In plain language:

- existing agents generate and execute
- Aperture decides what deserves operator attention, when, and in what form

The product promise should sound like:

- connect your agents
- get one calm place for approvals, blocked work, failures, and meaningful
  follow-ups
- trust that the judgment layer is deterministic, inspectable, and improving

## Strategic North Star

The active Aperture product family should be understood as:

1. **Aperture Local**
   - a calm local-first attention surface for coding agents
2. **Aperture SDK**
   - the embeddable deterministic judgment layer

Those are the product lines we should actively harden, package, and learn from
right now.

The large swing is still not:

- better notifications
- better approval UX
- another operator dashboard

It is:

- the judgment and attention layer for agent work
- the deterministic system that decides what deserves operator focus
- the product that makes agent activity calmer, more legible, and more
  replayable

## Future Optionality

There is still a plausible future cloud line for Aperture, but it should be
treated as optionality rather than active roadmap direction.

If it is ever revisited, the best version would keep the same discipline:

- deterministic hot-path judgment stays local or customer-controlled
- the cloud layer handles routing, policy, identity, and audit
- the API reuses Aperture's existing bounded human-input and response contracts

What we should preserve today is the option value, not the product motion.

That means continuing to protect:

- clean `SourceEvent` and response contracts
- bounded human-input request types
- provenance, impact, and auditability
- cloud-neutral runtime boundaries
- replay and calibration infrastructure

What we should not do right now is let speculative cloud or marketplace ideas
distort the current technical roadmap.

The current technical job is still:

- make Local obviously good
- make the SDK stable and credible
- make adapters reliable
- make the replay and calibration loop compound

## Moat

The moat is not model weights.

The moat is the system:

1. **Deterministic hot-path judgment**
   - routing stays inside `aperture-core`
   - no model call is required to decide whether work becomes active, queued,
     or ambient

2. **Cross-source normalization**
   - multiple hosts collapse into one bounded event language
   - this is what lets operator behavior compound across adapters

3. **Replay and calibration**
   - real sessions can be replayed through real Core code
   - disagreements can be reviewed offline and turned into bounded fixes

4. **Inspectable explanation**
   - provenance and impact make the system auditable for both users and lab
     iteration

5. **Local-first operator memory**
   - response patterns, tolerance, and calibration can compound over time
     without moving intelligence into an opaque hosted control plane

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

Status: `experimental live path`

What is true today:

- package boundary exists
- live App Server transport exists
- experimental stock-CLI hook ingress exists
- `pnpm codex:run` and `pnpm codex:start` are real operator paths
- end-to-end approval supervision is proven for supported request families

What is still weaker than Claude and OpenCode:

- only a small set of request families are live-verified
- many Codex events remain notifications rather than actionable requests
- the bigger constraint is still what Codex App Server externalizes, not the basic Aperture adapter path
- broader shared-surface Codex convergence remains structurally uncertain

## Adapter Expansion Strategy

We should expand adapters selectively, not broadly.

The right next adapters are the ones that either:

- create meaningful new behavioral pressure on the judgment layer
- or sharpen the product wedge directly

That means the near-term bias should be:

1. keep Claude Code healthy
2. keep OpenCode healthy
3. strengthen Codex by validating more real request families and interruption semantics
4. evaluate Cursor later if we want stronger background-agent and cloud-agent
   pressure

What to avoid:

- building an adapter zoo for its own sake
- adding new adapters before the shared judgment loop is ready to benefit from
  them

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

The highest-value core work is still not breadth.

It is making the engine better at:

- understanding operator behavior
- adapting safely over time
- anticipating when human attention will be needed
- staying calm under ambiguity

For the engine ordering, see:

- [Engine Roadmap](./engine-roadmap.md)
- [Core Maturation Plan](./core-maturation-plan.md)
- [Architecture Principles](../engine/architecture-principles.md)

## Recommended Near-Term Sequence

Ordered by leverage:

1. **Finish the current F-Stop release loop**
   - finish the active pre-release sweep
   - inspect `swe-smith/xml` and `open-agent-sessions/approved`
   - merge only defensible core findings
   - cut the next `aperture-core` and `aperture` releases

2. **Keep Claude Code healthy as the flagship path**
   - it should remain the easiest obvious success path

3. **Keep OpenCode healthy as the second live path**
   - it pressure-tests the shared runtime and TUI with a source Aperture does not control

4. **Build replay / evaluation as a first-class loop**
   - compare routing behavior
   - review disagreements
   - tune thresholds offline

5. **Support the published package deliberately**
   - keep examples healthy
   - keep npm/GitHub docs honest
   - harden based on real consumer friction

6. **Prove one non-TUI host surface later**
   - only after the evaluation loop is more mature
   - see [Host Surface Expansion Note](./host-surface-expansion-note.md)

## What We Are Still Not Doing Enough

The most interesting open strategic opportunities are:

1. **Operator modeling as a first-class asset**
   - explicit interrupt tolerance, batching preference, approval strictness,
     and ambiguity tolerance

2. **Anticipation before interruption**
   - prepare the operator before the agent stalls
   - wait for one more correlated signal when that reduces noise

3. **Autonomy envelopes**
   - go beyond simple allow/block
   - define how far an agent can continue silently, when it should summarize,
     and when it must stop now

4. **Team-level attention policy**
   - shared risk, escalation, and trust policy for multi-agent teams

5. **Shadow mode and certification**
   - evaluate agent/operator burden without taking control of the live runtime

6. **Cross-agent continuity**
   - preserve work meaning, episode grouping, and attention budgets across
     multiple agent surfaces

7. **Judgment-network primitives**
   - human identity, qualification, reputation, availability, and SLA-aware
     routing

8. **Minimum-context packaging**
   - make judgment requests smaller, safer, and more legible than raw agent
     transcripts

9. **Remote inbox surfaces**
   - move from one local TUI toward a real decision surface that can be used
     from anywhere

10. **Responder scoring and review quality**
   - distinguish speed from correctness
   - track reversals, rework, escalation quality, and decision trust

## What To Avoid

- adding new adapters just to broaden the source list
- widening the public SDK surface casually
- moving tuning or learning into the hot path
- letting host-specific convenience leak into core judgment semantics
- becoming a generic eval platform
- becoming a generic agent orchestrator
- becoming an untrusted gig-work marketplace without policy, audit, or context
  discipline
- making the cloud version a hidden remote semantic service in the hot path

The right bias now is:

- keep the live paths trustworthy
- keep the published package honest
- deepen confidence before broadening scope
- deepen the core before broadening the product story
