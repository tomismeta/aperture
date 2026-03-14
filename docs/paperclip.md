# Paperclip Adapter

`@aperture/paperclip` is an optional adapter for Aperture.

In the current product shape:

- `@aperture/runtime` owns the live `ApertureCore`
- `@aperture/paperclip` maps Paperclip events into `SourceEvent`
- the runtime consumes those events and emits `AttentionResponse`
- `@aperture/paperclip` maps those responses back into Paperclip actions

Use it when you want Aperture to sit between Paperclip and the human loop.

It is intentionally split into two parts:

- pure mapping
- optional transport helpers

## What It Does

Ingress:

- `PaperclipLiveEvent -> SourceEvent[]`

Egress:

- `AttentionResponse -> PaperclipAction | null`

Transport helpers:

- `streamPaperclipLiveEvents(companyId, options)`
- `executePaperclipAction(action, options)`

The adapter does not decide final Aperture semantics. It translates Paperclip shapes into adapter inputs and maps responses back out again.

## Supported Paperclip Live Events

Currently mapped:

- `heartbeat.run.queued`
- `heartbeat.run.status`
- `activity.logged` for `approval`
- `activity.logged` for `issue`

Currently ignored:

- `heartbeat.run.event`
- `heartbeat.run.log`
- `agent.status`
- `activity.logged` for unrelated entity types

## Current Approval Return Path

Currently mapped:

- `approved -> POST /api/approvals/{id}/approve`
- `rejected -> POST /api/approvals/{id}/reject`
- `dismissed -> POST /api/approvals/{id}/request-revision`

Currently not mapped:

- `option_selected`
- `form_submitted`

Those return `null` until there is a concrete upstream meaning worth preserving.

## Example

Direct-core example:

```ts
import { ApertureCore } from "@tomismeta/aperture-core";
import {
  executePaperclipAction,
  mapPaperclipFrameResponse,
  mapPaperclipLiveEvent,
  streamPaperclipLiveEvents,
} from "@aperture/paperclip";

const core = new ApertureCore();

for await (const liveEvent of streamPaperclipLiveEvents("company-id", {
  baseUrl: "http://localhost:3000",
  headers: { Authorization: "Bearer token" },
})) {
  for (const event of mapPaperclipLiveEvent(liveEvent)) {
    core.publishSourceEvent(event);
  }
}

core.onResponse(async (response) => {
  const action = mapPaperclipFrameResponse(response);
  if (!action) return;

  await executePaperclipAction(action, {
    baseUrl: "http://localhost:3000",
    headers: { Authorization: "Bearer token" },
  });
});
```

That integration path uses:

- `streamPaperclipLiveEvents(...)` for ingress
- `mapPaperclipLiveEvent(...)` into `SourceEvent`
- `ApertureCore` for semantic normalization and attention decisions
- `mapPaperclipFrameResponse(...)` back to Paperclip actions from `AttentionResponse`
- `executePaperclipAction(...)` for egress

## Boundary

`@tomismeta/aperture-core` remains Paperclip-agnostic, and the long-term intended host for this adapter is `@aperture/runtime`.

If this package is removed, core still compiles and behaves the same.
