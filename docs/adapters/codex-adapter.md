# Codex Adapter

This note defines the current architecture and operating posture of
`@aperture/codex`.

The adapter is built around **Codex App Server** and keeps a strict boundary:

- `@aperture/codex` owns transport, protocol, mapping, and response routing
- `@tomismeta/aperture-core` remains Codex-agnostic
- Codex continues to own execution, auth, sandboxing, and native request
  identity

This document is both:

- the architecture note for the adapter as currently implemented
- the reference point for future Codex expansion while the integration remains
  experimental

## Napkin

At the simplest level, the Codex integration is:

```text
+--------------+    +------------------+    +------------------+    +------------------+    +------------------+
|   Codex App  | -> |   @aperture/     | -> |   Aperture       | -> |   @aperture/     | -> |   Codex App      |
|    Server    |    |     codex        |    |      core        |    |     codex        |    |    Server        |
|  protocol    |    |  translate facts |    | judge attention  |    | translate reply  |    |  native result   |
+--------------+    +------------------+    +------------------+    +------------------+    +------------------+

JSON-RPC over        requests / notices     SourceEvent in        AttentionResponse     approval answer,
stdio by default     -> SourceEvent         AttentionView out     -> Codex payload       user input answer,
websocket optional   thread / turn local    no Codex types        request correlation    request resolved
today
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
- `stdio` is the default transport, not the architecture itself
- `websocket` is available for shared or remote App Server sessions, but still
  experimental

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
| shared external transport | experimental         | WebSocket-capable shared App Server route     |
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

Transport selection today:

```bash
pnpm codex:start
```

```bash
pnpm codex:start -- --transport websocket --url ws://127.0.0.1:8765
```

The same transport flags work for `pnpm codex:run`, and the full local stack
can forward them via:

```bash
pnpm aperture -- --codex --codex-transport websocket --codex-url ws://127.0.0.1:8765
```

## Current Transport Story

Where the transport story stands today:

- `stdio` is the default and best-supported live path
- `websocket` is implemented and available for shared or remote App Server
  setups
- the adapter can accommodate both transport paths without changing the core
  judgment stack
- transport is no longer the main architecture constraint

What is still limiting the live Codex path:

- `A stronger App Server interruption contract`
  - Codex still externalizes too few human-relevant moments as first-class
    server requests
  - too much remains notification-only instead of becoming a blocked-on-human
    interaction Aperture can supervise directly

- `A unified App Server client path across Codex surfaces`
  - even with websocket support on our side, the bigger open question is
    whether macOS app, TUI, VS Code, and other Codex surfaces converge on one
    shared App Server seam
  - until that hardens, multi-surface Codex supervision is still structurally
    uncertain

So the current posture is:

- keep `stdio` as the default live path
- keep `websocket` available for shared-surface experiments
- wait for Codex's request externalization and surface convergence story to
  mature

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

## Current Assessment

Where the integration stands today:

- `proven`
  - the end-to-end approval path works
  - real Codex App Server requests can become focused Aperture frames
  - approving in the TUI successfully resumes Codex work
- `promising`
  - the transport seam is correct
  - the adapter boundary is clean
  - coarse lifecycle and approval supervision are behaving as designed
- `not ready for the live path`
  - only a limited set of request families are live-verified
  - conversational user-input flows are still weak or absent
  - most of the stream is still status and deltas without actionable hooks

So the current posture should be:

- freeze the architecture here
- keep the adapter available for continued learning and spot validation
- wait for more Codex App Server developments or a clearer request surface

## What We Are Waiting On

Two macro developments would materially improve this integration:

- `A stronger App Server interruption contract`
  - more first-class, actionable points where external clients can intervene
  - clearer guarantees around when human-relevant moments become server
    requests instead of remaining ordinary notifications
  - better semantics for:
    - request opened
    - request resolved
    - blocked on human input
    - resumed after human input
    - completed

- `A unified App Server client path across Codex surfaces`
  - macOS app, TUI, VS Code, and other Codex clients converging on the same
    App Server transport path
  - less ambiguity about whether external integrators are building against the
    same client contract OpenAI itself is standardizing on
  - lower risk that some important human-interruption behaviors only exist in a
    native client path and not in App Server

One secondary but important hygiene item:

- `Generated protocol remains the compatibility contract`
  - generated schema should stay more authoritative than prose examples
  - this matters most when request names, enums, or payload shapes evolve

## Current Foundation

The repo now includes a minimal `@aperture/codex` package with:

- a generated App Server protocol snapshot plus Aperture-owned wrappers
- a stdio App Server transport client
- a websocket App Server transport client
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

## Sources

- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness/)
