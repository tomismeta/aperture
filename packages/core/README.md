<div align="center">

# Aperture Core SDK

**The deterministic judgment engine inside Aperture.**

[![npm version](https://img.shields.io/npm/v/%40tomismeta%2Faperture-core?label=npm&color=0f766e)](https://www.npmjs.com/package/@tomismeta/aperture-core)
[![license](https://img.shields.io/badge/license-MIT-6f42c1)](https://github.com/tomismeta/aperture/blob/main/LICENSE)
[![architecture](https://img.shields.io/badge/docs-architecture-475569)](https://github.com/tomismeta/aperture/blob/main/docs/product/architecture-overview.md)

A deterministic SDK for deciding what should interrupt now, what should wait until next, and what should stay ambient.

</div>

Published on npm as `@tomismeta/aperture-core`.

Use this SDK when your agents can produce approvals, follow-up questions,
status updates, or blocked work, and you need one place to decide:

- what should interrupt a human now
- what should wait until next
- what should stay ambient

You send events in, Aperture gives you frames and surfaced state to render, and
you send the human's answer back.

This package is the judgment engine only. Runtime hosting, source adapters, and
the TUI live elsewhere in the repo.

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

The goal is simple: give one human a calm, deterministic way to supervise many
parallel agent workflows.

## Why It Exists

When you supervise multiple agents, everything can interrupt at once:

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

`event -> interpret and normalize -> judge -> surface -> respond`

That maps to:

- `ApertureEvent` or `SourceEvent`
- shared event meaning plus context
- policy, value, criterion, and continuity-aware judgment
- surfaced state for now / next / ambient
- `AttentionResponse` back into core

If you want the full repo-level architecture, including runtime, adapters, and
the TUI, see [Architecture Overview](https://github.com/tomismeta/aperture/blob/main/docs/product/architecture-overview.md).

If you want the replay, benchmark, and calibration direction for evaluating
judgment changes, see [Aperture Lab](https://github.com/tomismeta/aperture/blob/main/docs/lab/aperture-lab.md).

## Install

```bash
npm install @tomismeta/aperture-core
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

If you want to invoke Aperture's semantic parsing directly before publishing a
canonical `ApertureEvent`, use the advanced semantic entrypoint:

```ts
import { interpretSourceEvent, normalizeSourceEvent } from "@tomismeta/aperture-core/semantic";
```

That subpath exists for advanced adapter authors. The root package remains the
recommended SDK loop.

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

- `active`
  - the item that should hold focus now (`now` in user-facing language)
- `queued`
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

- what is already active
- what is queued
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
{ taskId, interactionId, response: { kind: "text_submitted", text: "Use /Users/tom/dev/test" } }

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

If you use markdown-backed state, Aperture intentionally exposes only a small operator-facing judgment surface today:

- policy rule fields:
  - `auto approve`
  - `may interrupt`
  - `minimum presentation`
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

- `MEMORY.md`
  - learned behavior across sessions
- `JUDGMENT.md`
  - human-edited judgment and planner defaults
- `USER.md`
  - optional user preferences and overrides

You do not need to create or monitor these files unless you explicitly want persistence or human-editable local config.

For a markdown-backed setup, opt in with `ApertureCore.fromMarkdown(rootDir)` and then use `core.checkpointMemory()`.

## More Context

For the full product story, adapters, and runtime docs, see the main [Aperture repository](https://github.com/tomismeta/aperture).
