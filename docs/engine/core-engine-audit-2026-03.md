# Core Engine Audit (2026-03)

This note is a blunt audit of Aperture's core engine after the first public
package releases.

It is intentionally narrower than the full doctrine docs.

Use it when the question is:

- how strong is the engine right now?
- what is actually durable?
- what needs to tighten next?

## Grades

| Area                                | Grade | Notes                                                                                            |
| ----------------------------------- | ----- | ------------------------------------------------------------------------------------------------ |
| deterministic engine architecture   | A-    | coherent lanes, strong seams, replayable hot path                                                |
| adapter-vs-core boundary discipline | A-    | mostly strong, with occasional adapter mapping gaps like Claude `Search`                         |
| doctrine quality                    | B+    | good philosophy, but too many items are mixed together                                           |
| roadmap freshness                   | B-    | some docs drift behind the shipped product and current positioning                               |
| moat clarity                        | A-    | strongest around deterministic judgment, human-shaped memory, and cross-source attention routing |

## What Is Strong

The strongest parts of Aperture today are:

- deterministic hot-path judgment
- explicit separation of:
  - adapter facts
  - core semantics
  - hard policy
  - soft value
  - planning
  - state commit
- real traceability and replayability
- a meaningful learning loop:
  - signals
  - summaries
  - memory
  - next judgment

The engine is already much better than "alert sorting with extra words."

The architecture has a real shape:

- `SourceEvent -> ApertureEvent -> AttentionCandidate -> AttentionDecision -> AttentionFrame`
- policy and planner are explicit
- continuity is first-class
- learning does not own the authoritative routing path

That is a serious substrate.

## What Is Weaker Than It Looks

The engine is stronger than the doctrine docs make it look.

The current doctrine layer mixes together:

- durable invariants
- current implementation facts
- product aspirations
- empirical hypotheses

That creates three problems:

1. the source of truth is harder to scan
2. it is harder to tell what is sacred versus experimental
3. roadmap discussions drift into philosophy instead of narrowing risk

The main issue is not that the engine is weak.

The main issue is that the doctrine surface has become less disciplined than the
engine itself.

## Reduced Doctrine Set

These should be treated as the durable core doctrines.

### Tier 1: Core Invariants

These are the doctrines that should remain stable unless Aperture changes its
identity.

1. **Interruption credibility**
   - interruption is scarce and must stay trustworthy
2. **Decision over event**
   - surfaces should show the decision, not raw source noise
3. **Hard policy before soft value**
   - what is allowed must remain stricter than what is valuable
4. **Queue and ambient are first-class**
   - they are deliberate routing modes, not leftovers
5. **Continuity matters**
   - protecting focus is part of correctness
6. **Surface capabilities matter**
   - the engine must plan against real host constraints
7. **Non-response is signal**
   - silence is data, not absence of data

### Tier 2: Strong Working Theses

These are good Aperture theses, but they still need more validation or stronger
implementation grounding.

- minimum dwell
- decision-stream continuity shaping
- queue pressure shaping
- source-trust thresholding
- operator-override learning
- absence-aware reconnect behavior
- surface-capability degradation policy

### Tier 3: Research / Later Theses

These are promising, but should not be treated as core identity yet.

- breakpoint-aware promotion
- full pattern accumulation as a first-class planner concept
- simultaneous interrupt conflict sophistication
- richer resumption packaging
- timing-aware task-boundary sensing
- side-channel mode signals

## What The Moat Actually Is

The moat is not:

- the TUI
- the adapter glue
- approval prompts alone

The moat is the combination of:

1. deterministic judgment
2. operator-shaped memory
3. cross-source attention routing
4. episode-aware planning
5. inspectable traces and replay

That combination gets stronger as:

- native hosts make more local decisions
- agents run longer unattended
- humans need one attention surface above many agent surfaces

## What To Tighten Next

Ordered by leverage:

1. **doctrine cleanup**
   - separate invariants from hypotheses
2. **roadmap refresh**
   - reflect current package reality and current product positioning
3. **explicit ambiguity maturation**
   - continue making uncertainty conservative and inspectable
4. **surface capability modeling**
   - especially for non-TUI and conversational hosts
5. **Aperture memory clarity**
   - separate:
     - host constraints
     - explicit `APERTURE.md` preferences
     - learned `MEMORY.md` behavior
6. **host-native background signal**
   - make native autonomous decisions visible as ambient awareness without turning them into interruptions

## Recommendation

Treat the engine as strong enough to keep shipping on.

Do not redesign it from scratch.

Instead:

- reduce doctrinal sprawl
- keep boundaries crisp
- deepen ambiguity, surface capability modeling, and Aperture memory in that order
- keep validating the moat against real host behavior rather than abstract theory
