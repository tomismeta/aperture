# Codex App Server Integration Architecture

This note defines the fresh-start architecture for the new Codex App Server integration.

It assumes:

- the legacy Codex adapter has been removed
- the current `@aperture/codex` package is rebuilt around **Codex App Server**
- `@tomismeta/aperture-core` must remain Codex-agnostic
- the new integration should have a minimal footprint and a clean boundary

This is both:

- the architecture note for the current minimal implementation
- the target direction for future Codex expansion

## Napkin

At the simplest level, the Codex integration is:

```text
+--------------+    +------------------+    +------------------+    +------------------+    +------------------+
|   Codex App  | -> |   @aperture/     | -> |   Aperture       | -> |   @aperture/     | -> |   Codex App      |
|    Server    |    |     codex        |    |      core        |    |     codex        |    |    Server        |
|  protocol    |    |  translate facts |    | judge attention  |    | translate reply  |    |  native result   |
+--------------+    +------------------+    +------------------+    +------------------+    +------------------+

JSON-RPC over        requests / notices     SourceEvent in        AttentionResponse     approval answer,
stdio today          -> SourceEvent         AttentionView out     -> Codex payload       user input answer,
other transports     thread / turn local    no Codex types        request correlation    request resolved
later
```

The more explicit boundary view is:

```text
+--------------+    +------------------+    +------------------+    +------------------+
|   Codex App  | -> |  CodexTransport  | -> |   Codex mapper   | -> |  Aperture core   |
|    Server    |    |  stdio today     |    |  explicit facts  |    |  judgment only   |
|              |    |  replaceable     |    |  no heuristics   |    |  now/next/ambient|
+--------------+    +------------------+    +------------------+    +------------------+
        ^                                                                 |
        |                                                                 v
        +------------------- @aperture/codex response mapping <-----------+
                              AttentionResponse -> Codex-native reply
```

This is the key alignment:

- Codex App Server is the integration boundary
- `@aperture/codex` owns transport, event mapping, and response mapping
- `@tomismeta/aperture-core` only sees `SourceEvent` and `AttentionResponse`
- stdio is the current transport implementation, not the architecture itself

## Compatibility By Surface

This is the current Aperture disposition by Codex surface:

```text
+---------------------------+----------------------+-----------------------------------------------+
| Surface                   | Current disposition  | What it means                                  |
+---------------------------+----------------------+-----------------------------------------------+
| pnpm codex:run            | supported            | Real Codex App Server path through our client |
| pnpm codex:start          | supported            | Live adapter bridge into Aperture runtime     |
| pnpm aperture --codex     | supported            | Full local stack with TUI supervision         |
| direct Codex App Server   | supported in design  | The architectural boundary we target          |
| shared external transport | planned              | Future replacement for local stdio launch     |
| Codex macOS app           | indirect only        | Validates the App Server direction, but not   |
|                           |                      | a current Aperture event source               |
| Codex VS Code extension   | indirect only        | Same boundary, but no current shared session  |
| Codex JetBrains/Xcode     | indirect only        | Same story as other Codex host clients        |
| stock Codex CLI/TUI       | not integrated       | Use our App Server client path instead        |
+---------------------------+----------------------+-----------------------------------------------+
```

The important rule is:

- if a surface lets Aperture talk to Codex through the App Server boundary we
  can support it cleanly
- if a surface only proves that OpenAI itself is using App Server internally,
  it is useful validation but not yet a direct Aperture integration seam

## Verified Behavior

What is now proven end to end:

- Aperture can supervise a real Codex App Server session
- Codex can emit a real server request that `@aperture/codex` maps into
  `SourceEvent`
- Aperture TUI can surface that request as a focused `Now` frame
- approving in the TUI maps back into a Codex-native response and Codex
  continues the turn

The verified request family is:

- `item/commandExecution/requestApproval`

Observed approval round trip:

```text
[codex] server request item/commandExecution/requestApproval
[codex] mapped request item/commandExecution/requestApproval -> 1 SourceEvent(s)
[codex] runtime response approved for codex:commandApproval:...
[codex] notification serverRequest/resolved
```

That is the milestone:

```text
Codex App Server
-> @aperture/codex
-> Aperture runtime/core
-> Aperture TUI
-> AttentionResponse
-> Codex App Server
```

## Known-Good Smoke Test

This is the current deterministic approval-path smoke test:

```bash
APERTURE_CODEX_DEBUG=1 pnpm codex:run --cwd /Users/tom/dev/aperture --approval-policy on-request --sandbox read-only "Create a directory named codex-smoke-test and create hello.txt inside it."
```

Why this works:

- `on-request` allows Codex to ask instead of silently denying or auto-running
- `read-only` forces a real approval request for write-producing work
- the task is simple enough that the resulting approval is easy to understand

Current observed result:

- with `workspace-write`, simple workspace writes may not trigger approval
- with `read-only`, the same write request does trigger a real server request

## Current Limits

What appears to be a Codex App Server behavior limit today:

- not every human-relevant moment becomes a server request
- conversational prompts like "ask me first" do not necessarily become
  `item/tool/requestUserInput`
- many events remain notifications only:
  - `item/started`
  - `item/completed`
  - `item/agentMessage/delta`
  - `thread/status/changed`
  - `turn/completed`

So the main current limitation is usually not the Aperture adapter. It is that
Codex only externalizes some decision points as server requests.

What is an adapter limitation today:

- only some request families have been live-verified so far
- richer supervision is still intentionally conservative:
  - explicit server requests become `Now`
  - coarse lifecycle becomes ambient
  - noisy deltas are not promoted into attention claims

## Current Foundation

The repo now includes a minimal `@aperture/codex` package with:

- a stdio App Server transport client
- a small typed protocol subset for the MVP request and notification surface
- request and notification mapping into `SourceEvent`
- `AttentionResponse` mapping back into Codex server-request responses
- a runtime bridge that connects Codex App Server to `@aperture/runtime`
- a runnable adapter entrypoint via `pnpm codex:start` or `pnpm aperture --codex`

The implementation is intentionally narrow:

- command approvals
- file-change approvals
- tool-driven user input
- coarse thread, turn, and review lifecycle updates

It does not yet attempt to cover the full App Server schema or expose a broad
host-control surface above Codex.

## Why App Server

OpenAI now positions **Codex App Server** as the official surface for deep
Codex integrations. The official docs describe it as the interface used to
power rich clients and recommend it when you want authentication, conversation
history, approvals, and streamed agent events inside your own product.

App Server also gives us three important properties:

1. **Bidirectional JSON-RPC**
   - one client request can produce many streamed notifications
   - the server can also initiate requests back to the client for approvals and
     user input

2. **Stable conversation primitives**
   - `thread`
   - `turn`
   - `item`

3. **Versioned machine-readable schema generation**
   - `codex app-server generate-ts --out ...`
   - `codex app-server generate-json-schema --out ...`

That makes it the right foundation for a serious Aperture integration.

## Main Architectural Rule

**Codex owns agent execution. Aperture owns human attention judgment.**

That means:

- Codex remains authoritative for:
  - thread lifecycle
  - turn lifecycle
  - tool execution
  - approvals native to the harness
  - review mode
  - auth, config, and sandbox policy
- Aperture remains authoritative for:
  - what deserves attention now
  - what should wait until next
  - what should stay ambient
  - cross-thread prioritization
  - behavioral memory and interruption policy

## Product Boundary

```json
{
  "codex": {
    "owns": [
      "thread lifecycle",
      "turn lifecycle",
      "item stream",
      "tool execution",
      "review mode",
      "approval mechanics",
      "sandbox and auth"
    ]
  },
  "aperture": {
    "owns": [
      "SourceEvent mapping",
      "attention judgment",
      "now / next / ambient supervision",
      "behavioral memory",
      "operator surface",
      "response routing back to Codex"
    ]
  }
}
```

## Minimal-Footprint Recommendation

Build and keep exactly **one package**:

- `@aperture/codex`

That package should be **App Server-only**. Do not make it transport-agnostic.
Do not support legacy Codex request shapes. Do not try to be a general Codex
SDK wrapper.

### Why one package is enough

- core stays unchanged
- runtime stays the shared host
- TUI stays the main surface
- Codex-specific transport, protocol, and mapping all belong in one adapter
  package

## Recommended Internal Layout

```json
{
  "package": "@aperture/codex",
  "modules": {
    "protocol/generated": "generated TypeScript types from the installed Codex App Server version",
    "protocol/compat": "thin wrappers and guards around generated types",
    "transport/stdio": "spawn and manage `codex app-server` over stdio JSONL",
    "transport/ws": "optional later; not part of MVP",
    "session/client": "high-level App Server client for initialize, thread, turn, review, and server-request routing",
    "mapping/events": "Codex notifications and server requests -> SourceEvent[]",
    "mapping/responses": "AttentionResponse -> Codex server-request response payloads",
    "state/correlation": "threadId, turnId, itemId, requestId, and interaction correlation",
    "runtime/bridge": "connect the App Server client to @aperture/runtime"
  }
}
```

## Process Model

```json
{
  "processes": [
    {
      "name": "Codex App Server",
      "role": "long-lived Codex harness host",
      "ownership": "Codex"
    },
    {
      "name": "@aperture/codex transport client",
      "role": "connects to app-server, performs handshake, reads notifications, answers server requests",
      "ownership": "Aperture adapter"
    },
    {
      "name": "@aperture/runtime",
      "role": "hosts ApertureCore and shared surfaces",
      "ownership": "Aperture runtime"
    },
    {
      "name": "@tomismeta/aperture-core",
      "role": "judges SourceEvent / ApertureEvent and maintains surfaced state",
      "ownership": "Aperture core"
    }
  ]
}
```

## End-to-End Flow

```json
{
  "flow": [
    "codex app-server notification or server request",
    "@aperture/codex protocol client receives it",
    "@aperture/codex mapping converts only attention-significant signals into SourceEvent[]",
    "@aperture/runtime publishes SourceEvent[] into ApertureCore",
    "ApertureCore updates AttentionView",
    "operator or client responds",
    "@aperture/codex maps AttentionResponse back into the matching Codex server-request response",
    "codex app-server resumes the blocked turn or completes cleanup"
  ]
}
```

## What To Map Into Aperture

Do **not** mirror the full App Server stream into core.

Instead, split Codex messages into three buckets.

### 1. Attention-significant

Map these into `SourceEvent`.

```json
{
  "attention_significant": [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/tool/requestUserInput",
    "turn failure / blocked conditions",
    "review lifecycle events when they matter to supervision",
    "meaningful tool completion or failure summaries"
  ]
}
```

### 2. State-bearing but not interruptive by default

Map these sparingly into bounded `task.updated` events or keep them in adapter
local state.

```json
{
  "bounded_status": [
    "thread/started",
    "thread/status/changed",
    "turn/started",
    "turn/completed",
    "item/started",
    "item/completed"
  ]
}
```

### 3. High-volume rendering noise

Do **not** send these into core unless a later design proves they matter.

```json
{
  "ignore_or_aggregate": [
    "item/agentMessage/delta",
    "stdout/stderr deltas",
    "reasoning deltas",
    "streamed diff details",
    "fine-grained tool progress events"
  ]
}
```

## Recommended Mapping Contract

### Command approvals

```json
{
  "codex_request": "item/commandExecution/requestApproval",
  "source_event": {
    "type": "human.input.requested",
    "request.kind": "approval",
    "activityClass": "permission_request",
    "toolFamily": "bash",
    "title": "Approve Codex command",
    "context.items": [
      "command",
      "cwd",
      "networkApprovalContext"
    ],
    "provenance.whyNow": "reason"
  }
}
```

### File-change approvals

```json
{
  "codex_request": "item/fileChange/requestApproval",
  "source_event": {
    "type": "human.input.requested",
    "request.kind": "approval",
    "activityClass": "permission_request",
    "toolFamily": "write",
    "title": "Approve Codex file changes",
    "context.items": [
      "grantRoot",
      "changedFiles"
    ],
    "provenance.whyNow": "reason"
  }
}
```

### User input requests

```json
{
  "codex_request": "item/tool/requestUserInput",
  "mapping_rules": [
    {
      "when": "single question with options",
      "source_event.type": "human.input.requested",
      "request.kind": "choice",
      "activityClass": "question_request"
    },
    {
      "when": "multi-question or freeform input",
      "source_event.type": "human.input.requested",
      "request.kind": "form",
      "activityClass": "question_request"
    },
    {
      "when": "tool approval-like prompt with Accept/Decline/Cancel",
      "source_event.type": "human.input.requested",
      "request.kind": "approval",
      "activityClass": "permission_request"
    }
  ]
}
```

### Session and turn progress

```json
{
  "codex_signal": "turn lifecycle or thread lifecycle",
  "source_event": {
    "type": "task.updated",
    "status": "running | waiting | blocked | completed | failed",
    "activityClass": "session_status | follow_up | tool_completion | tool_failure | status_update"
  }
}
```

## Response Mapping Contract

Codex server requests should remain authoritative for request identity and
allowed decisions.

```json
{
  "approval_response_mapping": {
    "approved": "accept or acceptForSession when explicitly chosen",
    "rejected": "decline",
    "dismissed": "cancel"
  },
  "choice_response_mapping": {
    "option_selected": "answers payload keyed by Codex request/question ids"
  },
  "form_response_mapping": {
    "form_submitted": "answers payload keyed by Codex request/question ids"
  }
}
```

## Recommended Adapter API

The new package should expose two public surfaces:

### 1. Runtime bridge

Minimal happy path for live Aperture integration.

```json
{
  "createCodexRuntimeBridge": {
    "inputs": [
      "runtime client",
      "Codex app-server launch or connection config",
      "adapter identity"
    ],
    "does": [
      "connect to app-server",
      "initialize protocol",
      "map events to SourceEvent",
      "publish to runtime",
      "listen for AttentionResponse",
      "answer Codex server requests"
    ]
  }
}
```

### 2. Low-level client

For custom products that want the App Server transport and typed protocol
without the runtime bridge.

```json
{
  "CodexAppServerClient": {
    "capabilities": [
      "initialize",
      "thread.start",
      "thread.resume",
      "thread.fork",
      "thread.read",
      "turn.start",
      "turn.steer",
      "turn.interrupt",
      "review.start",
      "model.list"
    ]
  }
}
```

## Custom Input Support

Yes, the adapter should support Codex custom input directly.

Codex App Server supports `turn/start` and `turn/steer` with structured input
items such as:

- `text`
- `skill`
- `mention`

and also supports per-turn `outputSchema`.

That means the adapter should expose this **as a Codex transport capability**,
not as a core concern.

### Recommended shape

```json
{
  "CodexInputItem": [
    { "type": "text", "text": "string" },
    { "type": "skill", "name": "string", "path": "string" },
    { "type": "mention", "name": "string", "path": "string" }
  ],
  "CodexTurnStartOptions": {
    "threadId": "string",
    "input": "CodexInputItem[]",
    "cwd": "string?",
    "approvalPolicy": "string?",
    "sandboxPolicy": "object?",
    "model": "string?",
    "effort": "low | medium | high | xhigh ?",
    "summary": "string?",
    "personality": "string?",
    "outputSchema": "json schema?"
  }
}
```

### Boundary rule

```json
{
  "custom_input_rule": {
    "codex_adapter": "may expose custom Codex thread/turn methods",
    "runtime": "may choose to call them",
    "core": "must remain unaware of Codex-specific turn-start input items"
  }
}
```

## Review As A First-Class Capability

Codex App Server supports `review/start` with targets like:

- uncommitted changes
- base branch
- commit
- custom instructions

This is a strong differentiator and should be designed in from the beginning.

### Recommendation

Do not invent a separate review engine in Aperture.

Instead:

- let Codex do review execution
- let Aperture supervise review attention

### MVP treatment

```json
{
  "review_mvp": {
    "transport": "support review/start on the low-level client",
    "mapping": "map review lifecycle to task.started/task.updated/task.completed when useful",
    "surface": "let review requests compete for now / next / ambient like any other thread-level work"
  }
}
```

## Protocol Source Of Truth

This is important enough to be a hard rule:

```json
{
  "protocol_source_of_truth": {
    "do": [
      "generate TypeScript types from the installed Codex version",
      "generate JSON Schema from the installed Codex version",
      "commit or vendor only the generated protocol artifacts you actually use"
    ],
    "do_not": [
      "hand-maintain a large Codex request schema",
      "guess protocol fields from examples",
      "treat experimental features as stable defaults"
    ]
  }
}
```

## MVP Scope

Keep the first implementation tight.

```json
{
  "mvp": {
    "transport": [
      "stdio only"
    ],
    "supported_codex_capabilities": [
      "initialize",
      "thread/start",
      "thread/resume",
      "turn/start",
      "turn/steer",
      "turn/interrupt",
      "review/start",
      "command approval",
      "file-change approval",
      "tool requestUserInput"
    ],
    "excluded_for_now": [
      "websocket transport",
      "dynamic tool calls",
      "experimental API fields",
      "full-fidelity delta mirroring"
    ]
  }
}
```

## Future Extensions

```json
{
  "future_extensions": [
    "websocket transport once it is no longer experimental",
    "dynamic tool-call support once the API matures",
    "review-specific attention heuristics if review volume becomes a major source class",
    "host-driven Codex thread orchestration UI above Aperture",
    "more specific toolFamily classification for Codex-native item types"
  ]
}
```

## Final Recommendation

```json
{
  "keep_boundaries_clean": [
    "Codex App Server protocol stays in @aperture/codex",
    "@tomismeta/aperture-core only sees SourceEvent / ApertureEvent / AttentionResponse",
    "@aperture/runtime remains the shared host",
    "Aperture supervises Codex; it does not replace Codex"
  ],
  "optimize_for": [
    "cross-thread attention supervision",
    "rich approval context",
    "review as a premium workflow",
    "machine-readable protocol contracts",
    "minimal package footprint"
  ]
}
```

## Sources

- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness/)
