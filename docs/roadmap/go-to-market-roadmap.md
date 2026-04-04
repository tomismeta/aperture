# Aperture Go-To-Market Roadmap

This document captures the current product-direction view for bringing
Aperture to market.

Read this alongside the current engine and product source-of-truth docs:

- [Engine Status Pillars](../engine/engine-status-pillars.md)
- [Core Engine Audit (2026-03)](../engine/core-engine-audit-2026-03.md)

Some wording here predates the latest positioning cleanup, so the newer engine
and product docs should win when they disagree.

The central conclusion is:

- Aperture should be sold and distributed first as an opinionated local product
  for working with agent activity in one place.
- The published core SDK should remain available, but it should not be the main
  adoption path.

There is still a preserved cloud concept note in the roadmap folder, but it
should be read as future optionality, not as the active go-to-market plan.

## Executive Thesis

Aperture's best market position is not:

- another agent framework
- another eval dashboard
- another generic approval API

It is:

- the live attention surface for humans working with coding agents
- the deterministic judgment layer for human attention
- the product that decides what deserves operator focus, when, and in what form

This product should feel like:

- install one package
- run one command
- connect Claude Code, OpenCode, Codex, and future sources
- get a useful attention surface immediately

## Market Position

The surrounding market already has strong categories:

- agent runtimes and orchestration
- observability and traces
- evals and regression tooling
- approval primitives

Aperture should not compete head-on by trying to become the best generic system
in any one of those buckets.

Instead, Aperture should position itself at the intersection of:

- humans working with agents
- attention routing
- deterministic judgment
- cross-agent operator workflow

That means the external story should lead with:

- operator focus
- interruption quality
- triage and approvals
- replayable real-world agent work

It should not lead with:

- semantic normalization
- control plane
- attention doctrine
- judgment engine internals

Those are part of the moat, not the wedge.

## Wedge

The wedge is:

- the easiest way to get one calm surface for coding-agent work

The first product promise should be:

- "Install Aperture, connect your agents, and get one calm surface for
  approvals, blocked work, failures, and important follow-ups."

The first strong use cases are:

- Claude Code approvals and structured questions
- OpenCode live attention routing
- mixed-agent local sessions
- harvested replay of real sessions

## Moat

The moat deepens in four layers:

1. **Deterministic judgment**
   - Aperture can explain why an interaction landed in now, next, or ambient.

2. **Semantic normalization**
   - source-native mess becomes a bounded canonical event language.

3. **Harvested replay and evaluation**
   - real sessions can be captured, replayed, benchmarked, and improved over
     time.

4. **Cross-agent attention**
   - over time, Aperture can become the place where humans work with named
     agents, subagents, and multi-actor workflows.

## Product Packaging Strategy

### Core Principle

The package that is easiest to install should also be the package that delivers
the most obvious user value.

Today, that is not true:

- `@tomismeta/aperture-core` is published
- the TUI, runtime, and adapters remain repo-internal

That means the easiest public thing to consume is the deepest infrastructure
layer rather than the best product experience.

## Recommendation

Publish an official opinionated package that exposes the Aperture product path.

Recommended shape:

- npm package:
  - scoped package such as `@aperture/cli`, `@aperture/app`, or
    `@tomismeta/aperture`
- installed command:
  - `aperture`

Recommended behavior:

- `npx <package> aperture`
- or `pnpm dlx <package> aperture`
- runs the shared runtime
- auto-connects supported adapters
- opens the TUI
- supports capture out of the box

This package should bundle or depend on:

- runtime
- TUI
- adapter setup helpers
- source adapter integrations that are ready for product use

The core SDK should remain:

- the advanced programmable layer
- the embed path
- the infrastructure surface for serious integrators

## Product Surface Recommendation

The official package should make this the default experience:

1. install Aperture
2. run `aperture`
3. connect Claude Code and OpenCode
4. start seeing approvals, blocked work, failures, and follow-ups
5. optionally run with `--capture`
6. review or promote captures into replay assets later

This package should feel local-first and opinionated.

It should not ask the user to understand:

- `ApertureCore`
- event normalization
- source adapters as separate packages
- replay internals

## Future Optionality

If Local proves strong enough and real user demand emerges, Aperture may later
explore a separate cloud product for team or remote human routing.

That is not the active go-to-market motion now.

For current GTM purposes, the important point is narrower:

- keep the local product story clean
- keep the SDK credible
- do not position Aperture around speculative cloud judgment routing
- preserve the architectural option without making it the public wedge

## Packaging Boundaries

### Public Product Package

Should include:

- launcher
- runtime host
- TUI
- adapter auto-setup
- capture workflow
- clear first-run onboarding

Should not expose:

- deep judgment internals
- experimental adapter boundaries
- monorepo-only scripts and workflows

### Core SDK

Should continue to include:

- `ApertureCore`
- event and frame contracts
- advanced semantic subpath

Should remain:

- adapter-agnostic
- host-agnostic
- smaller than the full product

## Go-To-Market Sequence

### Phase 1: Productize The Default Local Path

Goal:

- make Aperture installable and valuable in under five minutes

Ship:

- official product package with `aperture` bin
- stable `aperture` launcher behavior
- adapter auto-connect for Claude Code and OpenCode
- `--capture` on the default launcher path
- polished README and quickstart

Success criteria:

- a new user can install and run Aperture without cloning the repo
- a new user can connect Claude Code in one sitting
- first useful approval or question appears in the TUI quickly

### Phase 2: Prove The Flagship Workflow

Goal:

- make one use case undeniably good

Primary workflow:

- working with Claude Code in one calm surface

Ship:

- first-run guided setup for Claude Code hooks
- a few known-good prompts or smoke tests
- polished handling for approvals, structured questions, and permission flows
- one-click or one-command harvested capture workflow

Success criteria:

- users can say "Aperture makes Claude Code easier to work with"
- flagship demos are consistent and repeatable

### Phase 3: Turn Replay Into A Product Loop

Goal:

- make Aperture feel more trustworthy over time than a simple approval layer

Ship:

- capture management
- wild vs clean captured scenarios
- promotion of raw bundles into replay assets
- simple benchmark and scenario reporting for operators

Success criteria:

- captures are easy to keep
- replay becomes a product feature, not just an internal engineering tool
- improvements can be demonstrated against harvested scenarios

### Phase 4: Broaden The Attention Surface

Goal:

- move from a single-agent CLI story toward cross-agent attention

Ship:

- stronger Codex support when the transport path is ready
- richer multi-agent session handling
- actor or participant metadata for named agents and subagents
- continuity and explanation that reflects who is blocked on whom

Success criteria:

- Aperture becomes useful across more than one agent environment
- cross-agent attention starts to feel like a category, not a demo

## Messaging

Recommended positioning line:

- "Aperture is the live attention surface for humans working with coding agents."

Supporting messages:

- one calm surface for approvals, blocked work, failures, and follow-ups
- deterministic attention judgment instead of notification spam
- capture and replay real sessions
- works with the agents you already use

Avoid leading with:

- "control plane"
- "semantic engine"
- "agent orchestration framework"
- "terminal notification manager"

## Distribution Plan

Primary channels:

- npm install or `npx` usage for the official package
- GitHub README and product docs
- short demo videos of real Claude Code and OpenCode workflows
- harvested replay examples that show real improvement over time

Early audience:

- coding-agent power users
- local-first AI developers
- teams already running Claude Code or OpenCode
- people who feel approval fatigue or notification overload

## What To Build Before Broadening

Before adding more adapters or product surfaces, Aperture should have:

- one polished official package
- one very strong flagship workflow
- one clean onboarding story
- one believable replay and capture story

Breadth before this point will dilute the wedge.

## Key Risks

1. **Publishing the wrong thing**
   - If the SDK remains the main public surface, adoption may skew toward a
     small advanced audience instead of product users.

2. **Framework drift**
   - If Aperture starts looking like a generic orchestration layer, it loses
     product clarity.

3. **Adapter fragility**
   - The product promise depends on live integrations feeling dependable.

4. **Too much abstraction too early**
   - Multi-agent and actor-aware workflows are promising, but should be added
     as bounded product seams, not as theoretical architecture work.

5. **Optionality distraction**
   - If speculative cloud or marketplace ideas start driving the story too
     early, Aperture can lose the clarity of its actual current wedge.

6. **Premature product branching**
   - A separate cloud line should only be pursued after Local has stronger user
     pull and a clearer reason to expand.

## Recommended Next Moves

1. publish an official opinionated npm package with the `aperture` command
2. keep `@tomismeta/aperture-core` as the advanced SDK path
3. polish the flagship Claude Code workflow until it is obviously good
4. make `--capture` and replay part of the default product story
5. preserve cloud optionality in the architecture, but do not build or market
   around it yet
6. only then broaden to deeper multi-agent workflows and additional surfaces
