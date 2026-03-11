# Codex Adapter

`@aperture/codex` is an optional adapter for `@aperture/core`.

Use it when you want Aperture to sit between Codex app-server requests and the human loop.

It preserves the same boundary as `@aperture/paperclip`:

- map upstream request shapes into `ConformedEvent`
- map `FrameResponse` back into upstream response descriptors
- keep semantic normalization and attention judgment inside `@aperture/core`

## What It Does

Ingress:

- `CodexServerRequest -> ConformedEvent[]`

Egress:

- `FrameResponse -> CodexClientResponse | null`

This first cut is mapping-first. Unlike `@aperture/paperclip`, it does not ship a transport client yet because Codex transport depends on the host integration shape.

## Supported Codex Requests

Currently mapped:

- `item/commandExecution/requestApproval`
- `execCommandApproval`
- `item/tool/requestUserInput`

Current behavior:

- command approval requests become Aperture `approval` frames
- single-question `request_user_input` requests with options become `choice` frames
- multi-question or freeform `request_user_input` requests become `form` frames

## Return Path

Currently mapped:

- approval `approved -> { decision: "approved" }`
- approval `rejected -> { decision: "denied" }`
- approval `dismissed -> { decision: "abort" }`
- choice and form responses -> `answers` payloads for Codex `request_user_input`

## Example

```ts
import { ApertureCore } from "@aperture/core";
import {
  mapCodexFrameResponse,
  mapCodexServerRequest,
  type CodexServerRequest,
} from "@aperture/codex";

const core = new ApertureCore();

const request: CodexServerRequest = {
  id: 17,
  method: "item/commandExecution/requestApproval",
  params: {
    itemId: "item:cmd:1",
    threadId: "thread-1",
    turnId: "turn-1",
    command: "git push origin main",
    cwd: "/repo",
    reason: "Network access required",
  },
};

for (const event of mapCodexServerRequest(request)) {
  core.publishConformed(event);
}

core.onResponse((response) => {
  const codexResponse = mapCodexFrameResponse(response);
  if (!codexResponse) return;

  console.log(codexResponse);
});
```

## Boundary

`@aperture/core` remains Codex-agnostic.

If this package is removed, core still compiles and behaves the same.
