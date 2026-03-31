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

Aperture should be understood as a three-surface product family:

1. **Aperture Local**
   - a calm local-first attention surface for coding agents
2. **Aperture SDK**
   - the embeddable deterministic judgment layer
3. **Aperture Cloud**
   - the human judgment network and routing layer for autonomous systems

The large swing is not just:

- better notifications
- better approval UX
- another operator dashboard

It is:

- the API through which agents invoke human judgment
- the routing layer that decides whether a human is needed at all
- the switchboard that decides which human should be asked
- the policy layer that decides what context may be shown and what decision
  forms are allowed

In the most ambitious version, Aperture Cloud becomes the infrastructure that
lets autonomous systems ask humans for judgment safely, briefly, and at scale.

## Aperture Cloud Thesis

Aperture Cloud should be framed as a distinct product, not a sidecar feature of
the local surface.

It is the highest-risk, highest-upside product line in the company:

- agents escalate approvals, exceptions, and ambiguous choices into Aperture
- Aperture decides whether a human is actually required
- Aperture routes that request to a qualified human pool
- the human responds with bounded structured judgment
- the agent resumes with a typed result

This is the "outsourced human judgment layer" version of Aperture, but it
should be packaged explicitly as **Aperture Cloud**.

The public-first cloud version is intentionally bolder than the safer
enterprise-only story:

- it tries to define the category early
- it makes the product legible faster
- it gives solo builders and small teams access to human judgment on demand
- it creates the possibility of a real network moat, not just a product moat

The danger is obvious:

- low-quality humans produce low-quality judgment
- the product can drift toward decontextualized gig work
- privacy and accountability failures become existential

So the Aperture Cloud thesis only works if Aperture owns:

- strict routing policy
- strong qualification and trust scoring
- minimum-necessary context packaging
- decision traceability and audit
- narrow, typed decision formats rather than freeform chaos
- responder quality calibration over time

That last point matters.

Aperture Cloud should not just route to humans.
It should learn:

- who is fast
- who is careful
- who gives high-quality decisions in which domains
- who should see more or less work over time

The cloud offering should be framed as:

- trusted human judgment on demand
- a human judgment API for agents
- a calibrated responder network

not:

- random humans for agent leftovers

## Architecture For Aperture Cloud

The architecture should remain hybrid.

The hot path should stay local or customer-controlled.
The cloud should become the dispatch, identity, policy, and audit layer.

```text
agent host / adapter
-> local or edge Aperture runtime
-> deterministic Aperture core
-> local decision:
   - interrupt local operator
   - queue
   - ambient
   - suppress
   - escalate
-> if escalate:
   Aperture Cloud Dispatch
   -> identity, availability, qualification, and policy
   -> human inbox web / mobile / desktop
   -> responder scoring and calibration
   -> structured decision response
-> response returned to runtime
-> typed action returned to the agent
-> capture, trace, replay, and calibration flow into Aperture Lab
```

That implies six durable product components:

1. **Aperture Runtime**
   - local or edge host
   - owns adapter attachment and return path
   - should preserve deterministic judgment locally

2. **Aperture Core**
   - deterministic judgment engine
   - decides whether human attention is needed
   - remains the authoritative hot path

3. **Aperture Cloud Dispatch**
   - cloud routing for human-required work
   - chooses the right human or pool
   - enforces policy, latency targets, and escalation rules

4. **Aperture Inbox**
   - the human response surface
   - presents bounded decisions with minimum useful context
   - should work on web, mobile, and desktop

5. **Aperture Policy**
   - defines who can answer what
   - defines what data can leave the local environment
   - defines when work stays local, team-internal, or network-routed

6. **Responder Calibration**
   - rates responder quality, speed, consistency, and reversal rates
   - should inform routing and trust, not just vanity scoring

7. **Aperture Lab**
   - replay, review, calibration, and regression control
   - improves not just judgment quality, but routing and context-packaging

## Aperture Cloud API

Philosophically, this should be treated as a human judgment API.

Agents invoke Aperture Cloud when they need:

- approval
- structured choice
- exception handling
- ambiguity resolution
- escalation to a more trusted human

The API should be narrow and typed.

Conceptually:

- request:
  - "a decision is needed"
- routing:
  - "who should answer?"
- response:
  - "here is the structured human judgment"

That is a much stronger framing than:

- inbox product
- marketplace
- approval bot

## Market Wedge For Aperture Cloud

The public-first wedge is not "all enterprises."

The first sharp wedge is:

- solo developers and small teams already using coding agents heavily
- people who do not have a second operator available on demand
- teams that already feel interruption cost but do not yet have internal
  judgment routing infrastructure

For them, Aperture Cloud can be:

- the fastest way to get a second human judgment layer without hiring a whole
  team

That is much more legible than selling:

- control planes
- doctrine
- semantic normalization

Once that wedge is real, the same system can move up-market into:

- team pools
- enterprise internal judgment routing
- vetted expert networks

## Moat In The Aperture Cloud Version

The moat broadens further if Aperture Cloud works.

In that version, the moat is:

1. **Deterministic judgment**
   - local hot-path trust and replayability

2. **Cross-agent normalization**
   - one bounded escalation language across many hosts

3. **Context packaging**
   - the right human sees the minimum useful context, not the full transcript

4. **Trust and qualification routing**
   - who is good at which decision classes
   - who is fast, careful, and reliable
   - what should never leave a local or org boundary

5. **Responder calibration**
   - who is overturned often
   - who gives high-signal decisions
   - which humans should receive more or less traffic over time

6. **Replay and calibration**
   - Lab improves both local judgment and network routing quality

7. **Network effects**
   - over time, the system learns which humans, teams, and expert pools are
     best for which judgment requests

This is the path where Aperture stops being only a product moat and starts
becoming a data-and-routing moat.

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
