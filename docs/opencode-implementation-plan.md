# OpenCode Implementation Plan

This document turns the OpenCode integration design into an execution plan.

It is intentionally narrower than the full design spec in [OpenCode Adapter](./opencode-integration.md).

The goal here is to define:

- the milestone sequence
- the PR sequence
- the repo hygiene rules
- the exit criteria for calling the adapter real

## Working Principle

The OpenCode adapter should prove something important about Aperture:

- the adapter can be source-specific
- the runtime can remain generic
- the TUI can remain source-agnostic
- the core package can remain unchanged

That means the default assumption for this plan is:

- **no required changes to the core package (`packages/core`, published as `@tomismeta/aperture-core`)**

If implementation pressure reveals a real engine gap, that should become a separate explicitly-justified core PR, not a convenience leak from adapter work.

## Scope

V1 should support:

- connecting to an existing `opencode serve` instance
- bootstrapping pending permissions and questions
- subscribing to OpenCode SSE
- mapping the initial OpenCode event set into `SourceEvent`
- rendering that work through the existing runtime + TUI path
- sending human responses back into OpenCode through existing reply APIs

V1 should not try to:

- replace OpenCode's native UI
- own every OpenCode event type
- expose OpenCode's `"always"` permission reply by default
- require any upstream OpenCode changes
- force any core-engine changes as part of adapter delivery

## Package And Runtime Shape

Current package:

- `packages/opencode` (`@aperture/opencode`)

Expected live stack:

- `opencode serve` runs OpenCode's server
- the runtime package (`@aperture/runtime`) hosts `ApertureCore` from the core package (`packages/core`, published as `@tomismeta/aperture-core`)
- the OpenCode adapter package (`@aperture/opencode`) connects to OpenCode and publishes source events into the runtime
- the TUI package (`@aperture/tui`) renders the human attention surface

## Milestones

### Milestone 0: Tracking And Guardrails

Purpose:

- create the implementation frame before code starts moving

Deliverables:

- a tracking issue for the overall adapter
- milestone issues for each phase below
- this implementation-plan doc
- explicit constraint recorded in issue/PR templates:
  - no required core package changes

Exit criteria:

- the work is broken into reviewable slices
- every milestone has a concrete "done means" statement
- the first implementation branch can start without architecture uncertainty

Suggested GitHub issue structure:

- epic: `OpenCode adapter`
- child issues:
  - `M1: scaffold OpenCode package and typed client contracts`
  - `M2: implement transport and bootstrap`
  - `M3: implement event and response mapping`
  - `M4: bridge OpenCode into the runtime`
  - `M5: local dev scripts and end-to-end docs`
  - `M6: hardening and release readiness`

### Milestone 1: Package Scaffold And Typed Contracts

Purpose:

- establish the package without touching runtime behavior yet

Deliverables:

- new package:
  - `packages/opencode/package.json`
  - `packages/opencode/tsconfig.json`
  - `packages/opencode/src/index.ts`
  - `packages/opencode/src/types.ts`
- exported config types for:
  - base URL
  - auth username/password
  - optional directory scoping
  - connection/reconnect options
- typed representations for:
  - SSE event envelopes we plan to support
  - permission list payloads
  - question list payloads
  - permission reply payloads
  - question reply payloads

Non-goals:

- no network client yet
- no mapping logic yet
- no runtime bridge yet

Exit criteria:

- `pnpm build` and `pnpm typecheck` pass with the new package
- types reflect the validated OpenCode transport shapes
- there is a clear public package entrypoint

PR shape:

- **PR 1: scaffold `packages/opencode` and typed API contracts**

This PR should stay boring on purpose.

### Milestone 2: Transport And Bootstrap Client

Purpose:

- implement the raw OpenCode client before introducing Aperture semantics

Deliverables:

- `packages/opencode/src/client.ts`
- support for:
  - listing pending permissions
  - listing pending questions
  - replying to permissions
  - replying to questions
  - rejecting questions
  - opening SSE streams
  - handling `server.connected`
  - handling `server.heartbeat`
- auth support:
  - HTTP basic auth
  - username defaults to `opencode`
- project scoping support:
  - `x-opencode-directory`
  - or `?directory=`
- tests with mocked fetch/SSE behavior

Important behaviors:

- the client must not assume a fixed port
- the client must surface transport failures clearly
- the client must support the pending-state bootstrap flow the design doc requires

Exit criteria:

- list/reply paths are covered by unit tests
- SSE subscription and reconnect behavior are test-covered at the transport level
- we can bootstrap pending work with no Aperture logic yet

PR shape:

- typically lands inside the main buildout PR

### Milestone 3: Source Mapping And Response Mapping

Purpose:

- translate OpenCode-native shapes into Aperture-native semantics, and back

Deliverables:

- `packages/opencode/src/mapping.ts`
- OpenCode event -> `SourceEvent[]` mapping for the initial supported set:
  - `permission.asked`
  - `permission.replied`
  - `question.asked`
  - `question.replied`
  - `question.rejected`
  - `session.status`
  - selected `message.part.updated`
- `AttentionResponse` -> OpenCode reply mapping
- stable task and interaction identity helpers
- `instanceKey` derivation logic

Important behaviors:

- native resolution events must clear or reconcile Aperture state correctly
- the mapping should default permission approval to `"once"`
- the mapping should not expose `"always"` in V1
- question replies must emit the exact `{ answers: string[][] }` shape

Exit criteria:

- mapping tests cover all initial supported event kinds
- response mapping tests cover:
  - approve
  - reject
  - acknowledge/no-op where appropriate
- identity generation is deterministic and scoped correctly

PR shape:

- typically lands inside the main buildout PR

### Milestone 4: Runtime Bridge

Purpose:

- connect the OpenCode client and mapping layer to the shared runtime

Deliverables:

- `packages/opencode/src/bridge.ts`
- adapter registration into the runtime via `@aperture/runtime`
- publish flow:
  - OpenCode event -> mapped `SourceEvent` -> runtime
- response flow:
  - runtime response -> mapped OpenCode reply call
- bootstrap flow:
  - list pending permissions/questions first
  - publish them
  - then subscribe to SSE
- basic dedup/reconciliation logic

Important behaviors:

- OpenCode-native responses resolved outside Aperture must not leave stale active frames
- bridge startup must be safe if OpenCode already has pending work
- bridge shutdown should be clean and not leave zombie heartbeats

Exit criteria:

- end-to-end adapter/runtime test proves:
  - pending permission enters Aperture
  - operator response leaves Aperture
  - OpenCode reply path is invoked correctly
- runtime state remains source-agnostic

PR shape:

- typically lands inside the main buildout PR

### Milestone 5: Local Dev UX And Documentation

Purpose:

- make the integration runnable by someone other than the person who wrote it

Deliverables:

- script(s), likely:
  - `scripts/opencode-adapter.ts`
  - optionally `pnpm opencode:start`
- root `package.json` script entries
- docs updates:
  - quickstart
  - environment/config examples
  - known limitations
  - headless recommended flow
- local development notes for:
  - auth
  - directory scoping
  - pairing with the existing TUI

Important behaviors:

- if no runtime is provided, adapter should discover or resolve it using the same local pattern as Claude where possible
- logs should be readable and explicit about:
  - OpenCode base URL
  - runtime URL
  - directory scope

Exit criteria:

- a developer can run:
  - OpenCode server
  - Aperture runtime
  - OpenCode adapter
  - TUI
- and see a documented permission/question loop work end-to-end

PR shape:

- typically lands inside the UX/polish PR

### Milestone 6: Hardening And Release Readiness

Purpose:

- decide when the adapter moves from "works locally" to "usable path"

Deliverables:

- resilience work:
  - reconnect stability
  - duplicate event handling
  - clearer transport errors
  - native-resolution race coverage
- optional richer lifecycle mapping from `message.part.updated`
- documentation cleanup for publication quality
- package polish for `packages/opencode`

Exit criteria:

- no known stale-frame bugs in the supported permission/question loop
- tests cover the bootstrap race and native-resolution race
- docs accurately describe supported and unsupported behavior
- the package is in a shape where publishing can be evaluated separately

PR shape:

- typically lands inside the UX/polish PR, with any extra runtime hardening split out only if it grows too large

This is the first milestone where publication should even be discussed.

## Pull Request Strategy

This project is large enough that one branch and one PR would be a mistake.

In practice, the clean review shape is:

1. scaffold and typed contracts
2. main adapter buildout
3. operator/dev UX and polish

Recommended branch naming:

- `codex/opencode-m1-scaffold`
- `codex/opencode-m2-buildout`
- `codex/opencode-m3-ux`

Recommended PR sizing rule:

- prefer reviewable PRs with one main idea
- avoid mixing transport, mapping, runtime wiring, and docs in the same PR unless the docs are the direct companion to the code

Recommended PR sequence:

1. scaffold
2. transport + mapping + runtime bridge
3. dev UX + shared-stack wiring + documentation

## GitHub Hygiene

### Issue Hygiene

Use:

- one umbrella issue for the adapter
- one issue per milestone
- checklists in milestone issues for code, tests, docs, and known limitations

Suggested labels:

- `adapter`
- `opencode`
- `runtime`
- `docs`
- `needs-tests`

### PR Hygiene

Every PR should state:

- what milestone it belongs to
- what is intentionally out of scope
- whether it changes core package behavior

Recommended PR checklist:

- tests added or updated
- docs updated if behavior changed
- no accidental core package changes
- runtime boundary remains generic
- known risks or follow-ups called out

### Commit Hygiene

Prefer clear, narrow commits like:

- `opencode: scaffold adapter package`
- `opencode: add transport client`
- `opencode: map permission and question events`
- `opencode: bridge adapter into runtime`
- `docs: add opencode quickstart`

Avoid mixing unrelated docs cleanup with adapter implementation commits unless the docs are required to explain the new behavior.

## Testing Strategy

Test pyramid for this work:

### Unit tests

In `packages/opencode/test`:

- type parsing / config shaping
- transport client behavior
- mapping functions
- response translation
- identity derivation

### Runtime integration tests

Using the shared runtime:

- bootstrap pending permission -> Aperture frame appears
- response submitted -> OpenCode reply request is sent
- native resolution event clears state

### Manual end-to-end validation

Before calling V1 complete:

1. run `opencode serve`
2. run Aperture runtime
3. run OpenCode adapter
4. attach TUI
5. trigger a permission request
6. approve from Aperture
7. confirm OpenCode continues
8. trigger a question request
9. answer from Aperture
10. confirm OpenCode continues

## Core Boundary Rule

If a task is blocked because the OpenCode adapter wants something new from the engine, stop and ask:

- is this a real Aperture engine maturity need?
- or is it OpenCode-specific convenience leaking upward?

Only the first kind should become a core change.

If a core change is justified, it should happen in a separate PR with its own motivation and tests.

## Recommended Order Of Work

If we are optimizing for learning and clean execution, the order should be:

1. Milestone 1: scaffold
2. Milestone 2: transport
3. Milestone 3: mapping
4. Milestone 4: runtime bridge
5. Milestone 5: dev UX
6. Milestone 6: hardening

This preserves the cleanest boundary:

- transport first
- semantics second
- runtime wiring third
- operator UX fourth
- hardening last

## Definition Of Success

The OpenCode adapter is successful when:

- Aperture can supervise a live OpenCode server with zero upstream OpenCode changes
- the permission/question loop works through the existing runtime + TUI path
- the adapter does not force changes into the core package
- the implementation is reviewable and maintainable package-by-package
- the docs tell a truthful story about what works today
