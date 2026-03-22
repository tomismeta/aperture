# Aperture Package Launch Plan

This document turns the go-to-market direction into a concrete packaging and
launch plan.

The goal is to make Aperture easy to adopt as a product without diluting the
core SDK.

See also: [Package Splitting Decision](./package-splitting-decision.md)

## Core Decision

Publish two distinct surfaces:

1. **Official product package**
   - the opinionated local product
   - installs an `aperture` command
   - owns the launcher, runtime, TUI, adapter setup, and default capture flow

2. **Advanced SDK package**
   - `@tomismeta/aperture-core`
   - remains the programmable judgment engine for embed use cases

This preserves a clean split:

- product users get a product
- advanced builders get an engine

## Recommended Package Architecture

### Public Packages

### 1. Official Product Package

Recommended shape:

- package name:
  - scoped package such as `@aperture/cli`, `@aperture/app`, or
    `@tomismeta/aperture`
- installed binary:
  - `aperture`

Recommended contents:

- opinionated launcher
- shared runtime
- TUI
- Claude Code setup helper
- OpenCode setup helper
- capture and promotion entrypoints that are useful to product users

Recommended user commands:

- `aperture`
- `aperture --capture`
- `aperture doctor`
- `aperture claude connect`
- `aperture opencode`

Recommended product promise:

- install one package
- run one command
- connect your agent environment
- immediately work through approvals, blocked work, failures, and follow-ups

### 2. SDK Package

Keep:

- `@tomismeta/aperture-core`

Purpose:

- embedded engine usage
- external runtimes
- advanced deterministic judgment integration

Rules:

- keep root surface ruthless
- keep `/semantic` as the advanced semantic subpath
- do not put runtime, TUI, or adapters into the SDK package

## Internal Workspace Structure

The monorepo can still keep the current internal package decomposition:

- `packages/core`
- `packages/runtime`
- `packages/tui`
- `packages/claude-code`
- `packages/opencode`
- `packages/lab`

But the public packaging should stop mirroring the repo too literally.

The official product package should compose those internals into one polished
experience.

The exact split decisions and release ordering are captured in
[Package Splitting Decision](./package-splitting-decision.md).

## Package Boundary Rules

### Official Product Package Should Own

- `aperture` launcher
- runtime boot and discovery
- TUI boot
- first-run adapter setup
- default capture workflow
- simple diagnostics and onboarding

### Official Product Package Should Hide

- lower-level runtime APIs
- adapter server internals
- lab-only internal workflows
- workspace-only scripts

### SDK Package Should Own

- `ApertureCore`
- event and frame contracts
- advanced semantic normalization entrypoint

### SDK Package Should Not Own

- terminal rendering
- source adapter configuration
- launcher orchestration
- product onboarding

## Recommended CLI Surface

The first public CLI should stay small.

### Day-one commands

- `aperture`
  - run the opinionated local product
- `aperture --capture`
  - run the product and export a bundle on exit
- `aperture doctor`
  - validate runtime, adapter, and environment health
- `aperture claude connect`
  - install or validate Claude Code hooks
- `aperture opencode`
  - show the OpenCode setup flow Aperture expects

### Day-two commands

- `aperture replay <bundle>`
- `aperture capture promote <bundle>`
- `aperture adapters`

Do not start with a huge CLI taxonomy.

## Packaging Recommendation

### Phase 1

Publish one official package with one clear story:

- this is the Aperture product

Do not publish separate public packages for:

- runtime
- TUI
- Claude adapter
- OpenCode adapter

Those can stay internal or workspace-only until there is real external demand
for each boundary independently.

### Phase 2

If external integrators start asking for composable host pieces, then consider:

- publishing `@aperture/runtime`
- publishing selected adapter helper packages

But only after the official product package is established.

## Launch Sequence

### Step 1: Productize The Package

Before launch, the package should support:

- install without cloning the repo
- one-command startup
- working `--help`
- stable `--capture`
- clear error handling when adapters are unavailable
- first-run instructions that are product-facing, not repo-facing

### Step 2: Polish The Flagship Flow

The flagship flow should be:

- Claude Code in one calm surface

The bar:

- hooks are easy to connect
- approvals show up cleanly
- structured questions work
- permission flows are understandable
- the TUI feels clearly better than native interruption sprawl

### Step 3: Ship The Replay Loop

The product package should make it easy to:

- capture a session
- save the bundle
- inspect or promote it later

Replay and harvested sessions should appear in the product story, not just in
internal docs.

### Step 4: Add Diagnostics

`aperture doctor` should validate:

- Node version
- runtime boot
- Claude hook connection state
- OpenCode connection/profile state
- bundle/capture directory writability

This will reduce onboarding friction more than another internal abstraction
will.

## Launch Checklist

### Package And Build

- choose and reserve the official package name
- add a public package with `bin.aperture`
- make the package build self-contained
- ensure the package works via `npx` or `pnpm dlx`
- verify tarball contents are product-clean

### Onboarding

- write a product-first README
- add a 5-minute quickstart
- add Claude Code quickstart
- add OpenCode quickstart
- add screenshots or terminal captures of the happy path

### Product Behavior

- `aperture` starts the full local product
- `aperture --capture` works with no extra metadata
- launcher reuses or boots runtime cleanly
- launcher does not die if one adapter is unavailable
- CLI output is understandable to non-contributors

### Quality Gates

- launcher smoke test on a fresh machine or clean environment
- Claude Code happy-path test
- OpenCode happy-path test
- capture smoke test
- replay smoke test against one harvested bundle
- `pnpm typecheck`
- product-package install proof from tarball

## Launch Assets

- npm README
- GitHub README updates
- one short demo video
- one harvested replay example
- one “why Aperture exists” explainer

## Early Metrics

For the product package, track:

- installs
- first-run success rate
- successful Claude connections
- successful OpenCode connections
- sessions launched
- sessions captured
- replay bundles promoted

For the product itself, track:

- approvals handled
- structured questions surfaced
- failures surfaced
- ambient versus active mix
- repeated user sessions

## Risks To Watch

1. **Shipping too many packages**
   - this fragments the story before the product is established

2. **Making the SDK the hero**
   - this helps advanced adopters, but weakens the wedge

3. **Underinvesting in setup quality**
   - if connection and launch are flaky, the product will feel unfinished no
     matter how good the engine is

4. **Overexposing internals**
   - the public package should feel simple and opinionated

## Recommended Immediate Next Moves

1. choose the official product package name
2. create the public package that wraps the existing launcher path
3. add `aperture doctor`
4. rewrite onboarding docs for the product package
5. run an end-to-end install proof outside the monorepo
6. launch with Claude Code as the flagship flow
