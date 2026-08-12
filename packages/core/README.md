<div align="center">

# Aperture Core SDK

**The deterministic judgment engine inside Aperture.**

[![npm version](https://img.shields.io/npm/v/%40tomismeta%2Faperture-core?label=npm&color=0f766e)](https://www.npmjs.com/package/@tomismeta/aperture-core)
[![license](https://img.shields.io/badge/license-MIT-6f42c1)](https://github.com/tomismeta/aperture/blob/main/LICENSE)
[![architecture](https://img.shields.io/badge/docs-architecture-475569)](https://github.com/tomismeta/aperture/blob/main/docs/product/architecture-overview.md)

A deterministic SDK for deciding what should interrupt now, what should wait until next, and what should stay ambient.

</div>

Published on npm as `@tomismeta/aperture-core`.

If you want the opinionated local CLI/TUI product, install
`@tomismeta/aperture` instead.

Use `@tomismeta/aperture-core` when you want to embed Aperture's judgment loop
inside your own host, runtime, plugin, or workflow layer.

Use this SDK when your agents can produce approvals, follow-up questions,
status updates, or blocked work, and you need one place to decide:

- what should interrupt a human now
- what should wait until next
- what should stay ambient

You send events in, Aperture gives you frames and surfaced state to render, and
you send the human's answer back.

This package is the judgment engine only. Runtime hosting, source adapters, and
the TUI live elsewhere in the repo.

If you need the local `/work` HTTP ingress for sending external work into a
running Aperture product instance, that belongs to
[`@tomismeta/aperture`](https://www.npmjs.com/package/@tomismeta/aperture), not
this SDK. The product-side contract is documented in
[Host-Neutral Ingestion Contract](https://github.com/tomismeta/aperture/blob/main/docs/product/host-neutral-ingestion-contract.md).

## Napkin Drawing

```text
+-----------+    +-------------+    +-------------+    +-------------+    +-------------+
|   Arrive  | -> | Interpret + | -> |    Judge    | -> |   Surface   | -> |  Respond    |
|   events  |    | Normalize   |    |  attention  |    |    state    |    |  decision   |
+-----------+    +-------------+    +-------------+    +-------------+    +-------------+

ApertureEvent     explicit shared    does this         AttentionFrame /     AttentionResponse
or SourceEvent    meaning from raw   deserve human     AttentionView        back into core
                  source facts       attention now?
```

If you only remember one thing, remember this loop:

`event in -> frame/view out -> human response in`

## What Core Is

`@tomismeta/aperture-core` is a judgment engine for human attention in agent systems.

It takes events from tools and agents, turns them into explicit shared meaning,
and decides what deserves attention now, what should wait until next, and what
should remain ambient.

The goal is simple: give one human a calm, deterministic way to work with many
parallel agent workflows.

## Why It Exists

When you work with multiple agents, everything can interrupt at once:

- tool approvals
- failures
- blocked work
- follow-up questions
- status noise

The hard problem is not moving events around.

The hard problem is deciding how human attention should be spent.

`@tomismeta/aperture-core` exists to answer that in the hot path, without
turning every judgment into a slow or expensive model call.

## What Core Does

`@tomismeta/aperture-core` does five things:

1. accepts events about agent work
2. normalizes their meaning into a shared attention model
3. judges what deserves attention now
4. maintains surfaced state your UI can render
5. accepts the human response back into the same loop

In practice, that means:

- `ApertureEvent` or `SourceEvent` in
- `AttentionFrame` and `AttentionView` out
- `AttentionResponse` back in

## Core Loop

The hot path inside core is:

`event -> enrich -> normalize observation -> compile judgment input -> judge -> surface -> respond`

That maps to:

- `ApertureEvent` or `SourceEvent`
- shared event meaning plus a compiled semantic/observation seam
- policy, value, criterion, and continuity-aware judgment
- surfaced state for now / next / ambient
- `AttentionResponse` back into core

If you want the full repo-level architecture, including runtime, adapters, and
the TUI, see [Architecture Overview](https://github.com/tomismeta/aperture/blob/main/docs/product/architecture-overview.md).

If you want the replay, benchmark, and calibration direction for evaluating
judgment changes, see [Aperture Lab](https://github.com/tomismeta/aperture/blob/main/docs/lab/aperture-lab.md).

For the current workspace release candidate, see [Aperture Core SDK v0.9.0](https://github.com/tomismeta/aperture/blob/main/docs/releases/aperture-core-v0.9.0.md).
The source workspace may occasionally be ahead of npm between release commits;
compare the package version you installed with npm when in doubt.

Runnable repo examples live in:

- [examples/core-full-engine/index.ts](https://github.com/tomismeta/aperture/blob/main/examples/core-full-engine/index.ts)
- [examples/core-attention-evaluator/index.ts](https://github.com/tomismeta/aperture/blob/main/examples/core-attention-evaluator/index.ts)
- [examples/core-judgment-primitives/index.ts](https://github.com/tomismeta/aperture/blob/main/examples/core-judgment-primitives/index.ts)
- [examples/core-kernel-entrypoint/index.ts](https://github.com/tomismeta/aperture/blob/main/examples/core-kernel-entrypoint/index.ts)
- [examples/core-kernel-host-embedder/index.ts](https://github.com/tomismeta/aperture/blob/main/examples/core-kernel-host-embedder/index.ts)
- [examples/core-semantic-entrypoint/index.ts](https://github.com/tomismeta/aperture/blob/main/examples/core-semantic-entrypoint/index.ts)
- [examples/core-trace-entrypoint/index.ts](https://github.com/tomismeta/aperture/blob/main/examples/core-trace-entrypoint/index.ts)

## Install

```bash
npm install @tomismeta/aperture-core
```

If what you want is the shipped product surface, install:

```bash
npm install -g @tomismeta/aperture
```

## Start Here

If you are new to the SDK, start with:

- `ApertureCore`
- `ApertureEvent`
- `SourceEvent`
- `AttentionFrame`
- `AttentionView`
- `AttentionResponse`

If you only want the happy path, stop there.

The root package intentionally stays small. It does **not** expose the lower-level
judgment primitives or semantic helper internals that Aperture uses inside the
repo itself.

The recommended loop is:

1. create `ApertureCore`
2. publish an `ApertureEvent` with `core.publish(...)`
3. if you get back an `AttentionFrame`, render it in your UI or workflow layer
4. when the human responds, call `core.submit(...)`

Use `SourceEvent` and `core.publishSourceEvent(...)` only when you are building an adapter from source-native events and want Aperture to normalize them first.

In practice, you usually build a small frame-handling component or service around this loop:

- events come in from your agents or runtime
- Aperture returns frames that your UI or workflow layer renders
- human actions on those frames are sent back with `core.submit(...)`

This is the same pattern the Aperture TUI uses.

The engine can do much more internally, but you do not need to model the middle to use the package successfully.

If you want the deterministic judgment primitive without Core's stateful event
loop, use the evaluator subpath:

```ts
import { evaluateAttention } from "@tomismeta/aperture-core/evaluator";

const record = evaluateAttention({
  claim,
  context: {
    current,
  },
  now: "2026-03-13T18:00:00.000Z",
});

console.log(record.evaluatedAt);
console.log(record.planning.route);
console.log(record.planning.plannedLane);
```

`evaluateAttention(...)` is pure and stateless. It evaluates one attention claim
against explicit context, config, and clock input, then returns a versioned
`AttentionDecisionRecord`. The claim timestamp remains the source occurrence
time; `record.evaluatedAt` records the evaluation clock. It does not apply
events, mutate state, accept human responses, replay sessions, or report a
realized lane. Use `ApertureCore` when you need those stateful engine behaviors.

If you want Aperture's embeddable semantic judgment contract without Core's
stateful surface loop, use the kernel subpath:

```ts
import {
  evaluateApertureKernelEvent,
  type ApertureKernelEvent,
  type SourceEvidence,
} from "@tomismeta/aperture-core/kernel";

const evidence = {
  kind: "payload",
  subject: "search",
  channel: "search",
  complete: true,
} as const satisfies SourceEvidence;

const event: ApertureKernelEvent = {
  id: "evt:command",
  workId: "work:command",
  occurredAt: new Date().toISOString(),
  kind: "work.updated",
  title: "Search observation",
  summary: "Host prose is descriptive and does not override the typed result.",
  status: "failed",
  facts: {
    capabilityFamily: "catalog",
  },
  evidence,
};

const result = evaluateApertureKernelEvent(event);

console.log(result.observation);
console.log(result.observationJudgment);
console.log(result.explanation.reasonCodes);
```

`evaluateApertureKernelEvent(...)` is the small embeddable kernel contract:

`neutral host event -> normalize -> observe -> judge`

It accepts the kernel-owned neutral event DTO, finalizes it through Aperture's
internal source seam, returns a bounded finalized-event projection, and returns
the observation document, deterministic judgment contract, and stable
explanation reason codes when the event shape has one.

If your host has its own event shape, keep that mapping outside core. The host
adapter should return an `ApertureKernelEvent | null`; pass accepted kernel
events to `evaluateApertureKernelEvent(...)`. The kernel owns normalization,
observation, and judgment after that boundary.

Use `facts.capabilityFamily` for explicit source-known capability facts.
`context.items` and `metadata` remain descriptive host payload fields; they do
not promote capability authority. Capability values are trimmed and lowercased
before judgment, but remain opaque identity: a capability name never implies
command, read, search, or authorization semantics.

Failed work updates may also carry `evidence`, a small typed `SourceEvidence`
fact supplied only when the host reliably knows what its native result means.
It can represent a complete outcome, diagnostic, payload, measured partial read
window, or authorization requirement. When present, typed evidence is
authoritative and Core derives the Observation, provenance, strength, semantic
agreement, recovery, consequence, and judgment. Title and summary text cannot
override it. When it is absent, Aperture retains its bounded structural text
grammar. Runtime validation rejects evidence on non-failed updates and rejects
malformed or incomplete variants.

Observation documents currently exist for failed work updates that carry
classifiable observational evidence, such as command success output, read
payloads, search output, structured execution output, source-limit diagnostics,
or rejected tool-use observations. Other candidate events can legitimately
return `observation: null` and `observationJudgment: null`; use the returned
`evaluation` and finalized `event` for those cases.

This subpath does not install adapters, open sockets, persist state, render UI,
or make the package live inside another product. It runs only when the host
imports `@tomismeta/aperture-core/kernel` and calls the kernel function.
Use `ApertureCore` when you need frames, views, continuity, and responses.

For advanced consumers, the internal path is now:

`SourceEvent/ApertureEvent -> finalized event (usually EnrichedApertureEvent) -> private semantic evidence -> normalized observation -> AttentionJudgmentInput -> AttentionCandidate -> judgment -> AttentionFrame/AttentionView + trace`

That private semantic-evidence step is not a public SDK contract. The public
kernel projection returns the normalized observation document and deterministic
judgment contract instead of exposing raw task-failure evidence internals.

If you want to invoke Aperture's semantic parsing directly before publishing a
canonical `ApertureEvent`, or you want the richer semantic types directly, use
the advanced semantic entrypoint:

```ts
import { interpretSourceEvent, normalizeSourceEvent } from "@tomismeta/aperture-core/semantic";
```

For a measured partial read, prefer a typed `SourceEvidence` diagnostic:

```ts
const evidence: SourceEvidence = {
  kind: "diagnostic",
  diagnostic: "source_limit",
  channel: "read",
  window: { unit: "lines", offset: 200, length: 100, total: 640 },
};
```

Adapters that know source output was clipped but cannot provide a measured read
window can pass a bounded semantic hint instead of encoding that fact into title
or summary text:

```ts
import type { SourceEvent } from "@tomismeta/aperture-core";
import { semanticHintsForTruncatedSourceEvidence } from "@tomismeta/aperture-core/semantic";

const event: SourceEvent = {
  id: "evt:test:failed",
  taskId: "task:test",
  timestamp: new Date().toISOString(),
  type: "task.updated",
  status: "failed",
  title: "Test command failed",
  summary: "The process exited nonzero after the captured output was clipped.",
  semanticHints: semanticHintsForTruncatedSourceEvidence({ status: "failed" }),
};
```

Use the hint only for adapter-known source-quality facts that do not satisfy a
typed evidence variant, such as clipped stderr or a transcript window that
omitted earlier evidence. It lowers semantic confidence and, for failed status
by default, preserves high consequence. It cannot lower failed evidence to
medium or low consequence. It does not parse logs, recover missing evidence, or
make unrelated failures severe.

If you want to type `onTrace(...)` callbacks directly or inspect why a route
happened through the public explanation contract, use the trace entrypoint:

```ts
import { isCandidateTrace, type ApertureTrace } from "@tomismeta/aperture-core/trace";
```

The public trace now preserves both:

- `event`
  - the finalized runtime event Aperture actually judged
- `eventTransition`
  - the original input event, the finalized event, and a field-level diff
- `candidateTransition`
  - the field-level diff from raw evaluated candidate to adjusted candidate
- `frameTransition`
  - the field-level diff from previous visible frame state to the new result

That makes it easy to inspect exactly what changed at each stage:

- source normalization or semantic defaulting
- heuristic and episode adjustment
- frame materialization

Those subpaths exist for advanced consumers. The root package remains the
recommended SDK loop.

## Host Constraints, Operator Profile, And Operator Learning

These are three different concepts, and they should stay separate.

### Host constraints

These describe what your host can actually render or accept.

Examples:

- whether ambient work can be shown at all
- whether the host supports single-choice or multiple-choice prompts
- whether the host supports forms
- whether the host supports freeform text replies

Use `surfaceCapabilities` for this.

```ts
import {
  ApertureCore,
  baseAttentionSurfaceCapabilities,
  mergeAttentionSurfaceCapabilities,
  type AttentionSurfaceCapabilities,
} from "@tomismeta/aperture-core";

const surfaceCapabilities: AttentionSurfaceCapabilities = mergeAttentionSurfaceCapabilities([
  baseAttentionSurfaceCapabilities,
  {
    topology: {
      supportsAmbient: false,
    },
    responses: {
      supportsSingleChoice: true,
      supportsMultipleChoice: false,
      supportsForm: false,
      supportsTextResponse: true,
    },
  },
]);

const core = new ApertureCore({
  surfaceCapabilities,
});
```

### Aperture preferences

This is explicit human-owned configuration.

Examples:

- quiet hours
- batching preferences
- tool-specific overrides

That lives in `APERTURE.md` and should reflect what the human wants, not
what a particular host happens to support.

### Aperture memory

This is learned behavior derived from repeated signals over time.

Examples:

- what gets dismissed quickly
- what usually needs more context
- what tends to come back after deferral
- which sources or consequence bands have earned trust

This is part of Aperture's wedge, but it should not be confused with host
constraints. A voice host might suppress ambient items because it cannot render
them cleanly, while the operator might still prefer ambient when using a richer
surface.

That distinction is why `surfaceCapabilities` belongs in the SDK contract even
though consumers could model host constraints outside core themselves.

## How Judgment Is Structured

The core engine now follows a stable hot path:

`evidence -> policy gates -> evaluation -> policy criterion -> routing -> continuity -> frame -> feedback`

In practical terms:

- `AttentionPolicy`
  - hard gates and interrupt criterion
- `AttentionValue`
  - candidate utility and memory-backed scoring
- `AttentionPlanner`
  - routing and continuity-aware switching
- `JudgmentCoordinator`
  - composes the path above and can explain the decision

If you call `coordinator.explain(...)` or inspect Aperture traces, you now get rule-level visibility into both:

- policy gate and criterion evaluation
- continuity rule evaluation

For the deeper implementation note behind that shape, see [docs/core-engine-architecture.md](https://github.com/tomismeta/aperture/blob/main/docs/engine/core-engine-architecture.md).

Those components describe how the engine is structured internally. They are not
the intended public npm entrypoints for most SDK consumers.

## 1. What Do I Send Into Aperture?

For most integrations, you call `core.publish(...)` with an `ApertureEvent`.

Start with the simplest useful case: a human input request.

```ts
import { ApertureCore, type ApertureEvent } from "@tomismeta/aperture-core";

const core = new ApertureCore();

const event: ApertureEvent = {
  id: "evt:approval",
  taskId: "task:deploy", // the broader unit of work this belongs to
  timestamp: new Date().toISOString(),
  type: "human.input.requested", // this event needs human action
  interactionId: "interaction:deploy:review", // stable id for this one decision
  title: "Approve production deploy",
  summary: "A production deploy is waiting for review.",
  request: { kind: "approval" }, // ask Aperture for an approve/reject frame
};

const frame = core.publish(event);

if (frame) {
  console.log(frame.title);
  console.log(frame.mode);
  console.log(core.getAttentionView()); // render the full current surface, not just this one frame

  core.submit({
    taskId: frame.taskId,
    interactionId: frame.interactionId,
    response: { kind: "approved" },
  });
}
```

When you publish a direct `ApertureEvent`, Aperture now enriches it with the
same bounded semantic defaults it would have inferred from a `SourceEvent`
normalization path. That means missing fields like `semantic`,
`activityClass`, `consequence`, `tone`, and approval-oriented `toolFamily`
can be filled in when they are safely derivable, while explicit event fields
still win.

If you need a fully manual direct-event path, opt out:

```ts
const frame = core.publish(event, { applySemanticDefaults: false });
```

This option does not bypass `SourceEvidence` on a failed update. Typed evidence
is an authoritative source fact, so Aperture still derives its canonical
semantic and judgment document.

You can also publish task lifecycle events like:

- `task.started`
- `task.updated`
- `task.completed`
- `task.cancelled`

Use `SourceEvent` only when you are building an adapter and want Aperture to normalize source-native facts into `ApertureEvent` first.

The input fields that matter most to Aperture's judgment are:

- `type`
  - whether this is a task update or something that needs human action
- `request.kind`
  - whether the human is being asked to approve, choose, or fill out a form
- `consequence`
  - how risky or important the event is if handled badly
- `tone`
  - how strongly the event should feel in the surface
- `taskId` and `interactionId`
  - continuity for the task and stable matching for the human response

## 2. What Do I Get Back From Aperture?

- input: publish an `ApertureEvent` with `core.publish(...)`
- immediate result: `AttentionFrame | null`
- current surface: `core.getAttentionView()`
- human action: submit an `AttentionResponse` with `core.submit(...)`

`publish()` returns an `AttentionFrame` when Aperture thinks the event should enter the human attention surface. It returns `null` when the event becomes a no-op or clear action.

A returned frame looks like this:

```ts
{
  taskId: "task:deploy",
  interactionId: "interaction:deploy:review",
  mode: "approval",
  tone: "focused",
  consequence: "medium",
  title: "Approve production deploy",
  summary: "A production deploy is waiting for review.",
  responseSpec: {
    kind: "approval",
    actions: [
      { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
      { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
    ],
  },
}
```

The important fields are:

- `mode`
  - what kind of interaction this is, like `approval`, `choice`, `form`, or `status`
- `tone` and `consequence`
  - cues for urgency, emphasis, or visual treatment in your UI
- `title` and `summary`
  - the human-readable content to show
- `responseSpec`
  - how the human can answer
- `taskId` and `interactionId`
  - the ids you send back in `core.submit(...)`

Your UI or workflow layer reads `frame.responseSpec`, renders the available actions or fields, and sends the chosen answer back with `core.submit(...)`.

If you want the whole current surface after each event, call `core.getAttentionView()`. It returns:

- `now`
  - the item that should hold focus now (`now` in user-facing language)
- `next`
  - items that still matter, but should wait (`next` in user-facing language)
- `ambient`
  - low-urgency background items (`ambient` in user-facing language too)

For async integrations, you can also subscribe instead of polling:

- `core.subscribe(taskId, listener)`
- `core.subscribeAttentionView(listener)`
- `core.onResponse(listener)`
- `core.onSignal(listener)`

## Why Are `publish(...)` And `submit(...)` Separate?

Because Aperture keeps state across events and responses.

- `publish(...)`
  - tells Aperture that something happened
- `submit(...)`
  - tells Aperture how the human answered

That lets Aperture keep track of:

- what is in now
- what is in next
- what the human has already answered
- signals that should affect future judgment

So the real loop is:

- event in
- frame out
- human answer in
- state updates

## How Do I Submit A Human Response?

When the human acts on a frame, call `core.submit(...)` with an `AttentionResponse`.

Common response shapes:

```ts
// approval
{ taskId, interactionId, response: { kind: "approved" } }
{ taskId, interactionId, response: { kind: "rejected", reason: "Needs rollback plan" } }

// choice
{ taskId, interactionId, response: { kind: "option_selected", optionIds: ["safe"] } }

// text response
{ taskId, interactionId, response: { kind: "text_submitted", text: "Use /workspace/project" } }

// form
{ taskId, interactionId, response: { kind: "form_submitted", values: { reviewer: "Tom" } } }

// acknowledgement or dismissal
{ taskId, interactionId, response: { kind: "acknowledged" } }
{ taskId, interactionId, response: { kind: "dismissed" } }
```

The response fields that matter most are:

- `response.kind`
  - tells Aperture what the human actually decided
- `reason`
  - useful when a rejection or dismissal should carry explanation
- `optionIds` or `values`
  - the concrete human choice for choice and form interactions

## 3. Do I Need Any Config Or Persistent Files?

No. The default path needs no files at all:

```ts
const core = new ApertureCore();
```

That gives you an in-memory engine with no required persistence or file management.

Only opt into persistence if you want learned behavior or local markdown-backed config. The opt-in path is `ApertureCore.fromMarkdown(rootDir)`.

The main options are:

- `surfaceCapabilities`
  - optional declaration of what the current attention surface can support for planning purposes
- `ApertureCore.fromMarkdown(rootDir)`
  - loads markdown-backed state from a directory
- `core.checkpointMemory()`
  - writes the current learned memory snapshot
- `core.reloadMarkdown()`
  - reloads markdown-backed state

If you use markdown-backed state, Aperture keeps the local model intentionally small:

- `APERTURE.md`
  - who is supervising the agents, how they prefer to work, and what Aperture may do without asking
- `MEMORY.md`
  - what Aperture has learned from prior sessions

`APERTURE.md` intentionally exposes only a small human-facing control surface today:

- preferences:
  - `control mode`
    - `hands-on`: ask sooner and keep configured auto-approval visible
    - `standard`: keep the default balanced routing posture
    - `focus`: ask later for non-blocking work
- policy rule fields:
  - `auto approve`
  - `may interrupt`
  - `minimum lane`
  - `require context expansion`
- ambiguity defaults:
  - `non blocking activation threshold`
  - `promotion margin`
- planner defaults:
  - `batch status bursts`
  - `defer low value during pressure`
  - `minimum dwell ms`
  - `stream continuity margin`
  - `conflicting interrupt margin`
  - `disabled continuity rules`

That boundary is deliberate. Aperture exposes the knobs that are useful to tune locally and keeps the rest of the judgment engine deterministic and inspectable by default.

If you use the markdown-backed path, Aperture may read:

- `APERTURE.md`
  - human-edited preferences, policy, and planner defaults
- `MEMORY.md`
  - learned behavior across sessions

You do not need to create or monitor these files unless you explicitly want persistence or human-editable local config.

For a markdown-backed setup, opt in with `ApertureCore.fromMarkdown(rootDir)` and then use `core.checkpointMemory()`.

## More Context

For the full product story, adapters, and runtime docs, see the main [Aperture repository](https://github.com/tomismeta/aperture).
