# `@aperture/codex`

The Codex App Server adapter for Aperture.

It connects the Codex App Server protocol to Aperture's attention engine
without leaking Codex-specific transport or client details into
`@tomismeta/aperture-core`.

## What It Does

`@aperture/codex`:

- receives Codex App Server requests and notifications
- translates attention-significant Codex facts into `SourceEvent`
- publishes those events into Aperture runtime and core
- maps `AttentionResponse` back into Codex-native replies

## Napkin

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

More explicitly:

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

## Boundaries

Codex owns:

- thread lifecycle
- turn lifecycle
- item execution
- approval mechanics
- review execution
- sandbox and auth

Aperture owns:

- event mapping into `SourceEvent`
- attention judgment
- `now / next / ambient` supervision
- operator-facing response handling
- response routing back to Codex

## Current Shape

The package currently includes:

- a Codex App Server client
- a pluggable `CodexTransport` seam
- a stdio transport implementation for `codex app-server`
- mapping from Codex requests and notifications into `SourceEvent`
- mapping from `AttentionResponse` back into Codex-native replies
- a runtime bridge for live Aperture integration

## Compatibility

Current Aperture disposition by surface:

```text
+-------------------------+----------------------+--------------------------------------------+
| Surface                 | Current disposition  | What it means                               |
+-------------------------+----------------------+--------------------------------------------+
| pnpm codex:run          | supported            | Real Codex App Server path through         |
|                         |                      | Aperture's client                           |
| pnpm codex:start        | supported            | Live adapter bridge into Aperture runtime  |
| pnpm aperture --codex   | supported            | Full local stack with TUI supervision      |
| Codex App Server        | supported in design  | The protocol boundary this package targets |
| shared external server  | planned              | Future replacement for local stdio launch  |
| Codex macOS app         | indirect only        | Not a direct Aperture event source today   |
| Codex VS Code client    | indirect only        | Same App Server family, no shared seam yet |
| stock Codex CLI/TUI     | not integrated       | Use the App Server client path instead     |
+-------------------------+----------------------+--------------------------------------------+
```

## Main Rule

Adapters provide facts. Core provides judgment.

For Codex, that means:

- `@aperture/codex` may understand Codex protocol, thread ids, turn ids,
  request ids, and custom input items
- `@tomismeta/aperture-core` must remain unaware of Codex App Server details

## What It Is Not

`@aperture/codex` is not:

- a general Codex SDK wrapper
- a bundled Codex binary
- a second judgment engine
- a place for Codex-native execution policy to leak into core

## Learn More

- [Codex App Server Architecture](/Users/tom/dev/aperture/docs/codex-app-server-architecture.md)
- [Canonical Judgment Model](/Users/tom/dev/aperture/docs/canonical-judgment-model.md)
