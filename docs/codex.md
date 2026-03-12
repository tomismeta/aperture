# Codex Adapter

`@aperture/codex` is an optional adapter for Aperture.

In the current product shape:

- `@aperture/runtime` owns the live `ApertureCore`
- `@aperture/codex` maps Codex requests into `ConformedEvent`
- the runtime consumes those events and emits `FrameResponse`
- `@aperture/codex` maps those responses back into Codex response descriptors

That keeps the same boundary as the other adapters:

- adapters translate source-native payloads
- `@aperture/core` owns semantic normalization and attention judgment
- `@aperture/runtime` is the shared host

## What It Does

Ingress:

- `CodexServerRequest -> ConformedEvent[]`

Egress:

- `FrameResponse -> CodexClientResponse | null`

This first cut is still transport-agnostic. Unlike `@aperture/claude-code`, it does not ship a real live transport yet because Codex does not expose a stable hook surface today.

What it does ship now:

- a stable mapping layer
- a runtime bridge that can publish Codex requests into `@aperture/runtime`
- a mock adapter path so we can validate the multi-agent runtime before real Codex hooks land

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

## Runtime Bridge

Use `createCodexRuntimeBridge(...)` when you have a Codex-native request stream and a way to send responses back. The bridge:

- maps `CodexServerRequest -> ConformedEvent[]`
- publishes those events into the shared runtime
- listens for `FrameResponse`
- maps relevant responses back into `CodexClientResponse`

That gives us a clean seam to swap in real Codex hooks later without rewriting the adapter logic.

## Example

Direct-runtime example:

```ts
import { ApertureRuntimeAdapterClient } from "@aperture/runtime";
import {
  createCodexRuntimeBridge,
  mapCodexFrameResponse,
  mapCodexServerRequest,
  type CodexServerRequest,
} from "@aperture/codex";

const adapterClient = await ApertureRuntimeAdapterClient.connect({
  baseUrl: "http://127.0.0.1:4546/runtime",
  kind: "codex",
  label: "Codex bridge",
});

const bridge = createCodexRuntimeBridge(adapterClient, {
  async sendCodexResponse(response) {
    console.log(response);
  },
});

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

await bridge.handleCodexRequest(request);
```

## Mock Path

Until Codex exposes a real hook surface, you can test the shared runtime path with:

```bash
pnpm serve
pnpm tui
pnpm codex:mock
```

`pnpm codex:mock` connects to the shared runtime and publishes a sample Codex approval request. If you pipe newline-delimited JSON requests into it, it will publish those instead and print mapped Codex responses back to stderr.

## Boundary

`@aperture/core` remains Codex-agnostic, and the intended host for this adapter is `@aperture/runtime`.

If this package is removed, core still compiles and behaves the same.
