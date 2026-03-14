# Paperclip Aperture Integration

This document describes a narrow first integration of Aperture into Paperclip.

The goal is not to replace Paperclip's orchestration, inbox, or approval architecture.
The goal is to add Aperture as an optional intermediary attention layer between
Paperclip's event stream and the human operator surface.

## Recommended Integration Mode

Paperclip has two plausible integration paths:

- plugin-hosted Aperture
- service-hosted Aperture

### Preferred V1: plugin-hosted Aperture

The preferred first implementation is a Paperclip plugin that:

- subscribes to Paperclip domain events
- hosts one `ApertureCore` per company inside the plugin worker
- renders an alternative attention surface using plugin UI slots
- maps human responses back into native Paperclip actions

Why this is preferred for V1:

- it is more additive
- it respects Paperclip's extension model
- it requires less host-core surgery
- it proves Aperture is an embeddable SDK rather than only a tightly-coupled service

Recommended plugin UI surfaces:

- `sidebarPanel`
- `dashboardWidget`
- later, if needed, a richer plugin page or detail tab

### Fallback / later path: service-hosted Aperture

A service-hosted integration is still valid, especially if Aperture later becomes a more core Paperclip concept.

That path remains useful if:

- plugin worker lifecycle proves too constrained
- the attention layer needs tighter coupling to host auth or routing
- the experience graduates from optional extension to product-default surface

For now, the service-hosted design in this document should be treated as a fallback or second phase, not the preferred first move.

## Goal

Add Aperture to Paperclip as an optional attention layer that decides:

- what deserves human attention now
- what should wait
- what should remain ambient

Paperclip continues to own:

- orchestration
- approvals
- issues
- heartbeat runs
- agent governance

Aperture owns:

- attention judgment
- active / queued / ambient presentation state
- response-aware state updates

## Core Thesis

The cleanest shape is:

- Paperclip domain event in
- Aperture frame / attention view out
- human answer in
- Paperclip side effect out

This keeps Paperclip as the product and Aperture as the judgment layer.

## V1 Scope

V1 should only cover high-signal human-facing events:

- approval created
- approval revision requested
- approval resolved
- failed runs
- blocked or follow-up-needed issue activity

V1 should not:

- replace the full Paperclip inbox
- ingest every live event type
- introduce Aperture markdown persistence into Paperclip
- require Paperclip to adopt Aperture semantics globally

## Architectural Boundaries

Keep four layers separate:

1. ingress mapper
   - Paperclip event -> `SourceEvent[]`
2. Aperture host
   - company-scoped `ApertureCore`
3. UI surface
   - render `AttentionFrame` / `AttentionView`
4. egress mapper
   - `AttentionResponse` -> Paperclip action

Rules:

- No Paperclip UI page should manually construct `SourceEvent`.
- No Paperclip page should compute active / queued / ambient itself.
- No Aperture host code should directly implement Paperclip business semantics.
- The response should go through Aperture first, then Paperclip side effects should be derived from it.

## Why The Plugin Path Fits Well

Paperclip already has a mature plugin system with:

- domain event subscriptions
- worker-hosted logic
- UI slots
- plugin-local streams
- scoped plugin state

That means a plugin can host the Aperture judgment loop without immediately requiring Paperclip host changes.

The current `@tomismeta/aperture-core` root package is still Node-host oriented, which fits a plugin worker well.

That makes the cleanest first move:

- plugin worker owns `ApertureCore`
- plugin worker subscribes to Paperclip domain events
- plugin UI renders attention surfaces through plugin slots
- plugin actions send responses back to the worker

## Adapter-Conformant Flow

This integration should conform to the adapter model.

Flow:

1. Paperclip emits a domain event.
2. A Paperclip ingress adapter maps it to one or more `SourceEvent`s.
3. A company-scoped `ApertureCore` receives `publishSourceEvent(...)`.
4. Aperture updates its attention state.
5. Paperclip publishes attention updates to the UI.
6. The UI renders frames.
7. The human acts on a frame.
8. The UI sends an `AttentionResponse` back to Paperclip.
9. The Aperture host calls `core.submit(...)`.
10. A Paperclip egress adapter maps the response into native Paperclip actions.

This preserves the distinction between:

- translation
- hosting
- rendering
- side effects

## Plugin-Side Design

Suggested plugin package shape:

- `packages/plugins/aperture-attention/manifest.ts`
- `packages/plugins/aperture-attention/worker.ts`
- `packages/plugins/aperture-attention/ui/index.tsx`
- `packages/plugins/aperture-attention/ui/AttentionPanel.tsx`
- `packages/plugins/aperture-attention/ui/AttentionWidget.tsx`

Suggested responsibilities:

### `worker.ts`

- hold `Map<companyId, ApertureCore>`
- subscribe to Paperclip domain events using the plugin event API
- map incoming Paperclip events into `SourceEvent[]`
- call `core.publishSourceEvent(...)`
- expose plugin data/actions for:
  - current attention view
  - response submission
- optionally emit plugin stream updates when attention state changes

### `ui/index.tsx`

- export slot components for:
  - `sidebarPanel`
  - `dashboardWidget`
- optionally export a launcher or page later if the surface needs to grow

### Manifest capabilities

The plugin will likely need capabilities along these lines:

- `events.subscribe`
- `plugin.state.read`
- `plugin.state.write`
- `ui.sidebar.register`
- `ui.dashboardWidget.register`

If plugin actions or streams are used in the standard way, keep those within ordinary plugin worker/UI bridge mechanisms rather than inventing new host routes.

## Service-Side Design (Fallback)

If the plugin path proves too limiting, the service-hosted shape remains available.

Suggested new files:

- `server/src/services/aperture/host.ts`
- `server/src/services/aperture/paperclip-ingress.ts`
- `server/src/services/aperture/paperclip-egress.ts`
- `server/src/routes/aperture.ts`

### `host.ts`

Responsibilities:

- hold `Map<companyId, ApertureCore>`
- expose:
  - `publishPaperclipEvent(companyId, event)`
  - `submitAttentionResponse(companyId, response)`
  - `getAttentionView(companyId)`

### `paperclip-ingress.ts`

Responsibilities:

- map Paperclip domain events into `SourceEvent[]`

Initial mapped classes:

- approval created
- approval revision requested
- approval resolved
- failed heartbeat runs
- blocked issue activity
- follow-up-needed issue activity

### `paperclip-egress.ts`

Responsibilities:

- map frame/response outcomes back to:
  - approval mutations
  - issue actions
  - wakeups
  - acknowledge / dismiss no-op cases

### `routes/aperture.ts`

Suggested routes:

- `GET /api/companies/:companyId/aperture/view`
- `POST /api/companies/:companyId/aperture/respond`

## UI Design

V1 should begin with plugin surfaces, not an inbox rewrite.

Preferred first surfaces:

- a `sidebarPanel`
- a `dashboardWidget`

These are the least confrontational places to prove the value of Aperture inside Paperclip.

They keep the integration:

- additive
- easy to compare with the current product
- respectful of Paperclip's most opinionated operator surface
- clearly optional

Within those surfaces, the presentation buckets should map to:

- active
- queued
- ambient

Each frame card should render:

- title
- summary
- source
- tone
- consequence
- why-now context
- actions from `responseSpec`

Only move toward an inbox-adjacent attention tab after the value is clear and the integration feels native.

## Recommended UX Shape

The best Paperclip-facing shape is not a fully separate standalone screen.

Instead, add an alternative view alongside the existing inbox:

- `Inbox`
- `Attention`

This keeps the integration:

- additive
- easy to compare with the current inbox
- familiar to existing Paperclip users
- clearly optional

If the integration later graduates from plugin surface to core product surface, then an inbox-adjacent route is a good next step:

- `/inbox/recent`
- `/inbox/unread`
- `/inbox/all`
- `/inbox/attention`

## UX Language

Paperclip should keep its own vocabulary at the surface.

Aperture should provide the judgment, but Paperclip should provide the voice.

### Keep Aperture terms mostly internal

These should stay implementation-level where possible:

- `SourceEvent`
- `AttentionFrame`
- `AttentionResponse`
- `responseSpec`
- `queued`
- `ambient`
- `consequence`
- `tone`

### Primary tab label

Use:

- `Attention`

Do not use:

- `Aperture`
- `Frames`
- `Priority Engine`

### Tab description

Recommended:

- `Aperture-ranked view of approvals, issues, and run updates that may need operator attention.`

Optional lighter version:

- `Aperture-ranked view of operator-facing events.`

### Section headings

Map Aperture buckets into Paperclip-friendly labels:

- active -> `Needs attention now`
- queued -> `Up next`
- ambient -> `Background`

Do not use raw bucket names as the primary UI labels.

### Actions

Use existing Paperclip verbs wherever possible:

- `Approve`
- `Reject`
- `Request revision`
- `Open issue`
- `Retry run`
- `Acknowledge`

Do not use:

- `Submit response`
- `Resolve frame`
- `Dismiss candidate`

### Why-now copy

Prefer operator-facing Paperclip language over internal Aperture reasoning language.

Good examples:

- `Waiting on board review`
- `Run failed and needs follow-up`
- `High-priority issue changed after your last touch`
- `Approval blocks agent progress`
- `Agent is waiting on a decision`

Avoid internal language like:

- `High attention value`
- `Planner promoted due to pressure`
- `Critical consequence with focused tone`

### Metadata labels

If these fields appear in the UI, rename them for operators:

- `consequence` -> `Risk`
- `tone` -> `Urgency`

Examples:

- `Risk: high`
- `Urgency: critical`

If the labels do not help the operator, hide them entirely and prefer plain-language rationale instead.

### Suggested empty states

Attention tab with no items:

- `Nothing needs operator attention right now.`
- `Paperclip is still tracking approvals, issues, and run updates. Aperture will surface them here when they need review.`

Needs attention now empty:

- `Nothing needs attention right now.`

Up next empty:

- `No follow-up is queued.`

Background empty:

- `No background items yet.`

### Suggested helper text

Small helper text near the tab or page header:

- `This view groups operator-facing events by what needs attention now, what can wait, and what can stay in the background.`

Optional subtle credit:

- `Powered by Aperture`

That credit should stay secondary to the Paperclip experience.

## Transport

Plugin-first transport should use the plugin bridge and plugin streams.

Recommended plugin-first behavior:

- worker updates `ApertureCore`
- worker emits lightweight stream or exposes refreshed data via plugin bridge
- UI uses `usePluginData(...)` and `usePluginStream(...)`

If the service path is used later, use Paperclip's existing company WebSocket.

Suggested live event additions:

- `attention.view.updated`
- optionally `attention.frame.presented`
- optionally `attention.frame.cleared`

Recommended behavior:

- server emits lightweight attention update notifications
- UI receives `attention.view.updated`
- UI refetches `GET /api/companies/:companyId/aperture/view`

This avoids overcomplicating the live event protocol in v1.

## Ingress Mapping

Use `SourceEvent`, not `ApertureEvent`.

Why:

- Paperclip already has its own source-native vocabulary
- this keeps the adapter model honest
- it validates Aperture's normalization boundary

### Initial mapping examples

Approval created:

- `type: "human.input.requested"`
- `request.kind: "approval"`
- title from approval type
- summary from approval payload
- stable `interactionId` per approval review thread
- consequence inferred from approval type or linked issue priority

Failed run:

- map into a human-relevant failure/interruption event
- include summary from stderr or error excerpt
- consequence inferred from agent role, linked issue, or project priority

Blocked / follow-up-needed issue:

- map issue activity into request or status-oriented source events
- carry linked issue priority into consequence

## Egress Mapping

Map `AttentionResponse` back into native Paperclip side effects.

Examples:

Approval frame:

- `approved` -> existing approve flow
- `rejected` -> existing reject flow
- future choice / revision paths can map to revision workflows

Failure/status frame:

- `acknowledged` -> usually only update Aperture state
- future actions could include retry, wakeup, or navigation helpers

Blocked issue frame:

- `choice.submitted` or `form.submitted` can map to:
  - comment
  - reassignment
  - wakeup
  - reopen / status change

Important:

- UI should not directly mutate Paperclip and separately notify Aperture.
- Human responses should enter Aperture first.
- Paperclip side effects should be derived from that response path.

## Persistence

V1 should use in-memory `ApertureCore` per company.

Do not introduce:

- `MEMORY.md`
- `JUDGMENT.md`
- markdown-backed Aperture runtime config

Potential later options:

- persist distilled memory in Paperclip DB
- store operator-specific learning snapshots in Paperclip tables

Known limitation in V1:

- server or worker restart resets learned in-memory attention state

That is acceptable for the first proving pass, but it should be explicit in the implementation and in any operator-facing rollout notes.

## Error Handling

The ingress adapter should be defensive.

For unrecognized or unsupported Paperclip events:

- do not throw in the host request path
- drop the event
- log a structured debug or warning record with event type and minimal identifiers

For malformed mapped events:

- reject at the adapter boundary
- log enough context to diagnose the mapper problem
- avoid poisoning the company-scoped `ApertureCore`

For failed egress actions:

- preserve the attention state transition result
- record the Paperclip side-effect failure separately
- surface retryable errors to the operator when appropriate

## Latency

The attention publish path should stay off critical request latency where possible.

Recommended behavior:

- Paperclip request handlers should complete their normal domain write first
- the attention publish should happen immediately after as a follow-on step
- UI-facing updates can arrive asynchronously through plugin streams or live events

For example:

- creating an approval should not wait on the UI to receive an attention update
- the operator surface can refresh after the approval is already durably created

## Testing Strategy

V1 should have narrow tests around the integration seam.

Recommended test layers:

- mapper unit tests
  - Paperclip event fixture -> expected `SourceEvent[]`
- egress unit tests
  - `AttentionResponse` + context -> Paperclip action or mutation intent
- host tests
  - publish event -> expected attention view state
- plugin integration tests
  - use the Paperclip plugin test harness if the plugin path is chosen
- UI tests
  - slot component renders attention sections and actions correctly from fixture view data

## First PR

The first PR should prove one narrow loop:

- approval created in Paperclip
- mapped to `SourceEvent`
- surfaced by Aperture in a plugin panel or widget
- operator approves or rejects there
- Paperclip approval state updates correctly
- attention view clears or updates correctly

That is enough to validate:

- the host boundary
- the adapter boundary
- the UI rendering model
- the response loop

## What Aperture Gains

- a real external consumer of `@tomismeta/aperture-core`
- a real non-TUI frame UI integration
- stronger validation of the adapter model
- pressure-testing of:
  - `SourceEvent`
  - `AttentionFrame`
  - `AttentionResponse`
  - `responseSpec`
  - active / queued / ambient semantics

## What Paperclip Gains

- an explicit attention layer between agent events and the operator
- deterministic triage for what interrupts now vs waits vs stays ambient
- a new attention surface backed by Aperture
- a more principled human-review path for multi-agent noise

## Invasiveness Assessment

This is not too invasive if it stays narrow and optional.

It becomes too invasive if it tries to:

- replace the Paperclip inbox immediately
- route every domain concept through Aperture
- force Paperclip business semantics into Aperture internals
- require Paperclip to adopt Aperture persistence/runtime assumptions

It stays appropriately scoped if it:

- starts with approvals and a few high-signal events
- keeps translation in dedicated adapter files
- keeps `ApertureCore` hosted behind one plugin worker or one Paperclip service
- renders one optional attention surface
- derives Paperclip side effects from the Aperture response loop

## Recommended Workspace

Use a separate Paperclip workspace:

- `/Users/tom/dev/paperclip`

Suggested branch:

- `codex/aperture-attention-layer`

## Repo Ownership

This integration should be split across the two repos deliberately.

### Aperture repo

The Aperture repo should continue to own:

- `@tomismeta/aperture-core`
- SDK docs
- integration design docs
- any SDK improvements discovered through the Paperclip integration

The Aperture repo should not own the first real Paperclip plugin implementation.

### Paperclip repo

The Paperclip repo should own the actual plugin package.

Recommended location:

- `packages/plugins/aperture-attention`

That package should depend on:

- `@paperclipai/plugin-sdk`
- `@tomismeta/aperture-core`

This keeps the split clean:

- Aperture provides the engine
- Paperclip provides the host product
- the plugin provides the integration layer

### Why this split is best

Reasons to keep the first implementation in Paperclip:

- the plugin depends on Paperclip's plugin runtime and UI slot system
- the first real implementation is easiest to validate in Paperclip's own workspace
- an upstream Paperclip PR is more natural if the code already lives inside their plugin package structure
- Aperture stays focused on the reusable SDK rather than owning host-specific product code

## Implementation Summary

Short version:

- build a real Paperclip plugin
- let that plugin depend on `@tomismeta/aperture-core`
- keep Aperture as the judgment engine
- keep Paperclip as the product host
- keep the plugin as the bridge between them
