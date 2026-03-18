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

## Verified Today

What is now proven:

- `@aperture/codex` can supervise a real Codex App Server session end to end
- Codex can emit a real approval request that Aperture maps into `SourceEvent`
- Aperture TUI can surface that request as a focused `Now` frame
- approving in the TUI routes a native response back to Codex and Codex
  continues the turn

The verified request family is:

- `item/commandExecution/requestApproval`

Known-good smoke test:

```bash
APERTURE_CODEX_DEBUG=1 pnpm codex:run --cwd /Users/tom/dev/aperture --approval-policy on-request --sandbox read-only "Create a directory named codex-smoke-test and create hello.txt inside it."
```

Current observed limitation:

- simple writes under `workspace-write` may not trigger approval at all
- not every conversational "ask the human" moment becomes
  `item/tool/requestUserInput`
- many Codex events stay as notifications rather than server requests

So today the main limit is usually the expressiveness of what Codex App Server
chooses to externalize, not the basic Aperture adapter path

## Current Assessment

- `proven`
  - real approval requests can be surfaced and answered end to end
- `promising`
  - the App Server boundary, transport seam, and mapping model are sound
- `not ready for the live path`
  - only a small set of request families are live-verified
  - most of the Codex stream is still status and deltas without actionable
    hooks

Protocol note:

- if official prose examples and generated protocol artifacts disagree, trust
  the generated schema from the installed Codex binary

## What We Are Waiting On

- `A stronger App Server interruption contract`
  - more first-class, actionable human-interruption points for external clients

- `A unified App Server client path across Codex surfaces`
  - macOS app, TUI, VS Code, and other clients converging on the same App
    Server transport route

- `Generated protocol staying the compatibility contract`
  - generated schema continuing to outrank prose examples when they differ

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

- [Codex Adapter](https://github.com/tomismeta/aperture/blob/main/docs/adapters/codex-adapter.md)
- [Canonical Judgment Model](https://github.com/tomismeta/aperture/blob/main/docs/engine/canonical-judgment-model.md)
