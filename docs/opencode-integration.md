# OpenCode Integration

This document describes the current OpenCode live source path for Aperture, along with the design constraints that shaped it.

For the milestone and PR sequence that follows from this design, see [OpenCode Implementation Plan](./opencode-implementation-plan.md).

The hard constraint remains:

- the integration must require zero OpenCode changes

That means:

- OpenCode remains the agent runtime
- Aperture remains the attention judgment layer
- the integration must work from OpenCode's existing public server and event surfaces

## Current Status

The OpenCode adapter is now a real working capability on `main`.

Today, Aperture supports:

- OpenCode permission approvals through the server / terminal path
- structured `question.asked` prompts through the server / terminal path
- lightweight blocked-awareness when OpenCode is waiting for a human follow-up reply
- one shared Aperture runtime and one shared TUI across Claude Code and OpenCode
- local Aperture-side connection profiles via:
  - `pnpm opencode:connect --global`
  - `pnpm opencode:disconnect --global`

The currently supported operator path is:

- `opencode serve --port 4096`
- `pnpm aperture`
- `opencode attach http://127.0.0.1:4096`

## Quickstart

This is the recommended full-stack OpenCode path:

```bash
git clone git@github.com:tomismeta/aperture.git
cd aperture
pnpm install
opencode serve --port 4096
```

In another terminal:

```bash
pnpm opencode:connect --global --url http://127.0.0.1:4096
pnpm aperture
```

Then, if you want OpenCode's terminal UI on the same server:

```bash
opencode attach http://127.0.0.1:4096
```

Current limitations:

- the native OpenCode macOS desktop app does not yet reliably surface all human gates through the same server-visible event path Aperture consumes
- generic freeform text entry in the Aperture TUI is not implemented yet, so OpenCode questions that implicitly allow custom typed answers are only partially represented today

## Goal

Add Aperture as an optional intermediary attention layer for OpenCode that can decide:

- what deserves human attention now
- what should wait
- what should remain ambient

The intended loop is still:

- OpenCode event in
- Aperture frame out
- human answer in
- OpenCode action or state update out

## Core Constraint

This integration must not depend on:

- new OpenCode plugin hooks
- new OpenCode routes
- new OpenCode event types
- suppressing or replacing OpenCode's native permission UI

It has to work against OpenCode as it exists today.

## Recommended Integration Mode

The preferred first shape is:

- **external sidecar adapter**
- **shared Aperture runtime**
- **separate Aperture TUI**

In other words:

- `opencode serve` runs OpenCode's server
- the runtime package (`@aperture/runtime`) hosts `ApertureCore` from the core package (`packages/core`, published as `@tomismeta/aperture-core`)
- the OpenCode adapter package (`@aperture/opencode`) connects to OpenCode and forwards events into the runtime
- the TUI package (`@aperture/tui`) renders the human attention surface

The bridge should accept normal connection options such as:

- base URL
- port
- optional auth credentials
- optional project directory scoping

This is not a second OpenCode runtime.

It is an external attention plane attached to the existing OpenCode runtime.

## Connection Model

OpenCode stays source-specific at the setup boundary:

- OpenCode runs its own server via `opencode serve`
- Aperture stores an OpenCode connection profile on the Aperture side
- the OpenCode adapter connects to that server and publishes source events into the shared runtime
- the TUI remains source-agnostic and does not own OpenCode connection setup

This is different from Claude Code because OpenCode's public integration seam is a server API rather than a hook config file.

## Command Surface

The intended OpenCode command path should mirror the Claude Code ergonomics, while keeping all OpenCode-specific configuration on the Aperture side:

```bash
pnpm install
pnpm opencode:connect --global --url http://127.0.0.1:4096
pnpm aperture
```

That means:

- `pnpm opencode:connect --global` stores an Aperture-side OpenCode connection profile in `~/.aperture/opencode.json`
- `pnpm aperture` starts the shared runtime, the Claude adapter, any configured OpenCode adapters, and the shared TUI
- OpenCode itself still runs separately via `opencode serve`
- the clean OpenCode terminal flow is `opencode attach http://127.0.0.1:4096`

If no auth parameters are provided, the connection profile assumes a local unauthenticated OpenCode server.

If a username is provided without a password env var, Aperture should prompt for the password and store it in the Aperture-side connection profile.

The product value is that Claude Code and OpenCode can both stream into one shared Aperture runtime and one shared TUI.

## Why This Works Without OpenCode Changes

OpenCode already exposes the right primitives:

- a headless server mode via `opencode serve`
- instance and global SSE event streams
- list/reply APIs for pending permissions
- list/reply APIs for pending question requests
- stable session identifiers and tool call identifiers
- optional HTTP basic auth on the server
- `server.connected` and `server.heartbeat` SSE events for stream health

That means Aperture does not need to intercept stdin, replace a TUI, or patch OpenCode internals.

Instead, it can:

1. watch OpenCode's event stream
2. bootstrap pending human work from list endpoints
3. render that work in Aperture
4. submit human responses back through OpenCode's existing reply endpoints

## What The Operator Gains

This integration is not only an Aperture validation exercise.

For an OpenCode user, the value is:

- one human attention surface across multiple OpenCode sessions
- better prioritization than a flat stream of native prompts
- active / queued / ambient treatment instead of binary interruption
- learned approval and response patterns over time
- better pressure handling when many OpenCode sessions are active at once
- a cleaner path toward episode-level grouping across related tool activity

The product story should be:

- OpenCode gives you a strong coding agent runtime
- Aperture gives you a stronger control plane for supervising it

## What OpenCode Continues To Own

OpenCode should continue to own:

- agent execution
- session lifecycle
- provider/model execution
- tool execution
- native permissions config
- question prompting semantics
- message and tool history

## What Aperture Owns

Aperture should own:

- semantic normalization of OpenCode events
- attention judgment
- active / queued / ambient presentation state
- cross-session attention shaping
- operator-facing prioritization and response routing

## V1 Scope

V1 should focus on the OpenCode events and responses that already form a real human loop:

- permission requests
- question requests
- session status changes
- selected tool lifecycle events from session message parts
- lightweight blocked-awareness for follow-up questions carried in assistant text parts

V1 should not try to:

- replace the native OpenCode UI
- own every OpenCode event type
- change OpenCode's permission policy model
- hide duplicate native prompts when a user is also looking at OpenCode's own UI
- add freeform text-entry support to the Aperture TUI as part of the adapter itself

## Architecture

The first implementation should look like this:

```text
OpenCode server -> OpenCode adapter package (@aperture/opencode) -> runtime package (@aperture/runtime) -> TUI package (@aperture/tui)
       ^                                                           |
       |-----------------------------------------------------------|
                        response APIs back into OpenCode
```

Flow:

1. OpenCode emits an event over SSE.
2. The OpenCode bridge maps that source-native event to one or more `SourceEvent`s.
3. The bridge publishes those `SourceEvent`s into the shared runtime package.
4. Aperture updates `AttentionView`.
5. The TUI package renders frames and view state.
6. The human responds in Aperture.
7. The OpenCode bridge maps that `AttentionResponse` back into an OpenCode reply call.
8. OpenCode resolves the waiting permission/question and continues execution.

## Package Shape

Recommended new package:

- `packages/opencode` (`@aperture/opencode`)

Suggested file shape:

- `packages/opencode/src/index.ts`
- `packages/opencode/src/client.ts`
- `packages/opencode/src/bridge.ts`
- `packages/opencode/src/mapping.ts`
- `packages/opencode/src/types.ts`
- `packages/opencode/test/opencode-adapter.test.ts`
- `packages/opencode/test/opencode-runtime.test.ts`

Suggested responsibilities:

### `client.ts`

Own the OpenCode transport layer:

- connect to SSE
- list pending permissions
- list pending questions
- reply to permissions
- reply to questions
- reject questions

### `mapping.ts`

Own source-native translation:

- OpenCode event -> `SourceEvent[]`
- `AttentionResponse` -> OpenCode reply call

### `bridge.ts`

Own the running adapter loop:

- subscribe to OpenCode
- publish into Aperture runtime
- listen for Aperture responses
- send those replies back into OpenCode

### `index.ts`

Export:

- mapping helpers
- transport helpers
- bridge constructor

## Runtime Topology

This should follow the same shape as the Claude Code path, but with a different ingress.

Claude Code today is:

- Claude hooks -> Claude adapter package (`@aperture/claude-code`) -> runtime package (`@aperture/runtime`) -> TUI package (`@aperture/tui`)

OpenCode should become:

- OpenCode server -> OpenCode adapter package (`@aperture/opencode`) -> runtime package (`@aperture/runtime`) -> TUI package (`@aperture/tui`)

So the full Aperture side remains familiar:

- the runtime package (`@aperture/runtime`) still owns the live `ApertureCore` from the core package (`packages/core`, published as `@tomismeta/aperture-core`)
- the TUI package (`@aperture/tui`) remains the surface
- only the source-specific ingress changes

## Ingress

### Transport

The bridge should use:

- SSE subscription for live events
- list endpoints for initial pending state bootstrap
- optional HTTP basic auth headers when the OpenCode server is protected
- optional `x-opencode-directory` header or `?directory=` query parameter for project scoping

Recommended bootstrap sequence:

1. connect to OpenCode server
2. list pending permissions
3. list pending questions
4. publish those into Aperture first
5. then begin SSE subscription

This reduces startup races and ensures Aperture does not miss already-waiting human work.

The bridge should also use:

- `server.connected`
- `server.heartbeat`

as liveness signals for reconnect and health monitoring.

### Verification Prerequisite

Before implementation, validate the live OpenCode server against a running `opencode serve` instance:

1. connect to the SSE stream
2. log raw event payloads
3. confirm the exact event type strings
4. confirm the actual payload shapes for:
   - `permission.asked`
   - `permission.replied`
   - `question.asked`
   - `question.replied`
   - `question.rejected`
   - `session.status`
   - `message.part.updated`

The current design uses the event names and shapes visible in OpenCode's source and generated SDK types, but the first implementation should still confirm the live wire format before building the mapping layer.

### Authentication

OpenCode's server can run unsecured on localhost, but it also supports HTTP basic auth when `OPENCODE_SERVER_PASSWORD` is set.

So the bridge client should support:

- unauthenticated localhost mode
- authenticated mode with:
  - username, defaulting to `opencode`
  - `Authorization: Basic ...`

If the OpenCode server is protected, the effective credentials are:

- username: `OPENCODE_SERVER_USERNAME` or `opencode`
- password: `OPENCODE_SERVER_PASSWORD`

This should be a standard client option, not a later add-on.

### Legacy Permission System

OpenCode currently contains both:

- a newer `PermissionNext` service
- an older legacy permission system

The public server routes and generated SDK types used by this integration are based on the newer permission system.

So the bridge should treat these as authoritative:

- `permission.asked`
- `permission.replied`

and should not base its primary logic on legacy-only events such as:

- `permission.updated`

### Initial Event Set

The first mapped OpenCode event set should be:

- `permission.asked`
- `permission.replied`
- `question.asked`
- `question.replied`
- `question.rejected`
- `session.status`
- `message.part.updated`

### Why These First

These give us the three most important categories:

- explicit human requests
- explicit human responses
- surrounding session/tool lifecycle context

That is enough for a real Aperture loop without needing every OpenCode event.

## Event Mapping

### `permission.asked`

Map to:

- `human.input.requested`

Use:

- `sessionID` as the primary task anchor
- `requestID` as the interaction anchor
- tool metadata and patterns as context

Recommended semantics:

- request kind: `approval`
- title from permission type
- summary from permission metadata / patterns
- source label should clearly say `OpenCode`

### `question.asked`

Map to:

- `human.input.requested`

Depending on structure:

- multiple-choice question -> `choice`
- multi-field question set -> `form`

The important thing is preserving:

- question headers
- options
- order
- whether custom input is allowed

### `permission.replied`

Map to factual state-clearing or follow-up events only when useful.

For V1, it is enough to:

- clear or reconcile the outstanding attention interaction
- optionally record a source event for timeline continuity

### `question.replied` / `question.rejected`

Same approach:

- clear or reconcile the matching interaction
- optionally record an ambient follow-up note if useful

### `session.status`

Map to:

- `task.updated`

This gives Aperture continuity context such as:

- busy
- idle
- retrying

These should not necessarily create interruptive frames by themselves.

They mainly help Aperture understand whether an OpenCode session is blocked, active, or recovering.

### `message.part.updated`

Use this selectively.

The OpenCode message-part stream is rich, but V1 should only derive a few high-signal events:

- tool started
- tool failed
- step finished with meaningful result
- maybe a waiting / blocked tool path when clearly visible

This should be thin and factual.

Do not try to semantically outsmart OpenCode here.

## Egress

The first response mapping should be intentionally narrow and reliable.

### Permission responses

Map Aperture responses to:

- `approved` -> permission reply `"once"` or `"always"`
- `rejected` -> permission reply `"reject"`
- `dismissed` -> permission reply `"reject"` or no-op, depending on the desired semantics

For V1, the safe mapping is:

- `approved` -> `"once"`
- `rejected` -> `"reject"`
- `dismissed` -> `"reject"`

Only introduce `"always"` when Aperture intentionally exposes that choice.

OpenCode also supports:

- `{ reply: "reject", message: "..." }`

for richer rejection feedback.

That is a good V2 enhancement path for Aperture, because it would let a human rejection carry corrective context back into the agent loop instead of only a bare denial.

### `"always"` Is A Policy Seam

OpenCode's `"always"` response is not just a one-off approval convenience.

It changes the effective permission model for the rest of the OpenCode session by auto-approving future matching requests.

That means Aperture should not expose `"always"` casually.

For V1:

- do not expose `"always"` by default
- use `"once"` as the default approval response
- treat `"always"` as a later explicit product choice

If Aperture ever introduces `"always"` in this integration, it should do so intentionally and transparently, because it becomes part of the operator's policy surface, not just the attention surface.

### Question responses

Map Aperture responses to:

- `option_selected` -> question reply answers
- `form_submitted` -> question reply answers
- `dismissed` -> question reject

The concrete OpenCode reply shape is:

- `{ answers: string[][] }`

That means:

- one outer array entry per question
- each question answer is an array of selected option labels

The egress mapping should preserve that exact shape instead of flattening it.

### Responses We Should Not Pretend To Support

Do not invent meanings for:

- arbitrary freeform responses when the OpenCode question expects enumerated answers
- multi-step workflow mutations outside permissions/questions

V1 should stay honest and only map what OpenCode already exposes cleanly.

## Identity Rules

The bridge needs stable IDs so Aperture can preserve continuity.

Recommended identity model:

- `taskId`
  - primarily session-scoped
  - examples:
    - `opencode:{instanceKey}:session:{sessionID}`
    - `opencode:{instanceKey}:session:{sessionID}:permission`

- `interactionId`
  - specific pending human request
  - examples:
    - `opencode:{instanceKey}:permission:{requestID}`
    - `opencode:{instanceKey}:question:{requestID}`

- `source`
  - `kind: "opencode"`
  - include workspace or directory label when available

Where `instanceKey` should be derived from stable bridge-local identity such as:

- OpenCode base URL
- project directory passed via `x-opencode-directory` or `?directory=`

This avoids collisions when one Aperture runtime observes multiple OpenCode instances or multiple workspaces attached to the same OpenCode server.

This should preserve:

- one session as one evolving attention stream
- one permission/question as one human interaction

## Recommended Product Shape

The strongest no-change OpenCode integration story is:

- run OpenCode headless with `opencode serve`
- run Aperture as the human attention surface

That gives the cleanest operator story:

- OpenCode executes
- Aperture decides what reaches the human
- the human responds in Aperture

This avoids fighting OpenCode's own TUI for attention.

The bridge should not assume one fixed port.

OpenCode may listen on:

- `4096`
- or another port if `4096` is unavailable or another port is explicitly configured

So the base URL or port should always be explicit bridge configuration, not a hardcoded assumption.

## Important Limitation

If a user is also actively using OpenCode's native TUI or web client:

- OpenCode will still show its own permission/question UI
- Aperture can still reply first
- but Aperture cannot suppress the native UI without upstream changes

If OpenCode's native UI resolves a request first, the bridge should rely on:

- `permission.replied`
- `question.replied`
- `question.rejected`

to clear or reconcile the corresponding Aperture interaction immediately.

That behavior is mandatory for the duplicative path; otherwise Aperture will show stale requests that OpenCode has already resolved.

## Native Permission Config Gaps

OpenCode has its own permission configuration and may auto-approve some actions without ever emitting a human-facing permission request.

That means:

- Aperture will only see requests that actually become pending human work
- some tool execution will never appear as `permission.asked`
- the early Aperture view may have gaps in the surrounding tool timeline

This is acceptable for V1.

It means the first integration is strongest as:

- a human attention surface for explicit pending work
- plus a gradually richer context surface from session and message-part events

So:

- **headless OpenCode + Aperture TUI** is the cleanest path
- **OpenCode UI + Aperture UI together** is possible, but duplicative

## Why This Is Still Worth Doing

Even with that limitation, this is a strong integration because it would prove:

- Aperture can attach to a real agent runtime without custom hooks
- Aperture can consume SSE/server-mediated human loops
- Aperture can return human answers back into another product's live execution
- Aperture does not require a proprietary transport shape to be useful

That is an important validation of the engine and adapter model.

## Phased Plan

### Phase 1: Thin Approval/Question Bridge

Build:

- OpenCode transport client
- event mapping for permissions/questions
- response mapping back into reply endpoints
- runtime bridge + TUI demo

Success means:

- an OpenCode permission appears in Aperture
- a human approves or rejects in Aperture
- OpenCode continues correctly

### Phase 2: Session Context Enrichment

Add:

- `session.status`
- selective `message.part.updated`
- better waiting / retry / failure context

Success means:

- Aperture frames carry more surrounding context
- active / queued / ambient feels more intelligent than mirroring prompts

### Phase 3: Host Maturity

Add:

- better startup bootstrap and reconnect behavior
- stronger timeout handling
- stronger duplicate suppression between bootstrap and SSE
- docs and example scripts

## Testing Strategy

The first package should have three test layers:

### Pure mapping tests

- raw OpenCode event -> `SourceEvent[]`
- `AttentionResponse` -> OpenCode reply payload

### Bridge tests

- simulate pending permissions/questions
- verify publish into runtime
- verify response loop back into OpenCode client

### Runtime integration tests

- OpenCode-like pending request
- Aperture frame appears
- response clears state and sends the expected reply call

## Recommended First Deliverable

The best first deliverable is:

- `packages/opencode`
- a local script like `scripts/opencode-adapter.ts`
- one demo flow:
  - start OpenCode server
  - start Aperture runtime + TUI
  - attach OpenCode bridge
  - answer a permission request from Aperture

That is enough to prove the architecture.

## Recommendation

Build OpenCode support as:

- a **thin source adapter and bridge**
- not a replacement runtime
- not an upstream patch

OpenCode is already the runtime.

The right Aperture move is to become the external attention plane that can listen, judge, and answer through OpenCode's existing server APIs.
