# `@aperture/opencode`

The OpenCode adapter for Aperture.

It connects OpenCode's server and event stream to Aperture's shared runtime and
judgment engine without leaking OpenCode-specific transport details into
`@tomismeta/aperture-core`.

## What It Does

`@aperture/opencode`:

- connects to an existing OpenCode server
- translates OpenCode events into `SourceEvent`
- publishes those events into Aperture runtime and core
- maps `AttentionResponse` back into OpenCode reply calls

## Napkin

```text
+--------------+    +------------------+    +------------------+    +------------------+    +------------------+
|  OpenCode    | -> |   @aperture/     | -> |   Aperture       | -> |   @aperture/     | -> |  OpenCode        |
|  server      |    |    opencode      |    |      core        |    |    opencode      |    | reply APIs       |
|  + stream    |    | translate facts  |    | judge attention  |    | translate reply  |    | permission/question
+--------------+    +------------------+    +------------------+    +------------------+    +------------------+

SSE events and       server events         SourceEvent in        AttentionResponse     reply calls back
list/reply APIs      -> SourceEvent        AttentionView out     -> OpenCode action     into OpenCode
```

More explicitly:

```text
+--------------+    +------------------+    +------------------+    +------------------+
| OpenCode     | -> | OpenCode client  | -> | OpenCode bridge  | -> | Aperture core    |
| server       |    | + mapper         |    | runtime routing  |    | judgment only    |
+--------------+    +------------------+    +------------------+    +------------------+
        ^                                                                 |
        |                                                                 v
        +------------------- @aperture/opencode response mapping <--------+
                             AttentionResponse -> OpenCode reply call
```

## Boundaries

OpenCode owns:

- agent execution
- server lifecycle
- question and permission semantics
- native session behavior

Aperture owns:

- event mapping into `SourceEvent`
- cross-session attention judgment
- operator-facing response routing
- bridge behavior around pending work and reconnects

## Current Shape

The package currently includes:

- an OpenCode client
- mapping from OpenCode events into `SourceEvent`
- mapping from `AttentionResponse` back into OpenCode reply calls
- a bridge that connects the live OpenCode server path to Aperture runtime
- bootstrap of pending permissions and questions from the server
- reconnect and heartbeat handling for the live event stream

## Current Assessment

- `live`
  - this is a supported source adapter path
- `strong`
  - the bridge, reconnect path, and pending-work bootstrap are all part of the current documented shape
- `bounded`
  - the clean path is still OpenCode server plus terminal, not native desktop parity

## Learn More

- [OpenCode Adapter](https://github.com/tomismeta/aperture/blob/main/docs/adapters/opencode-adapter.md)
- [Adapter Contract](https://github.com/tomismeta/aperture/blob/main/docs/product/adapter-contract.md)
