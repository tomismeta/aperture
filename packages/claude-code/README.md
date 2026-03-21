# `@aperture/claude-code`

The Claude Code adapter for Aperture.

It connects Claude Code's hook surface to Aperture's shared runtime and
judgment engine without leaking Claude-specific hook details into
`@tomismeta/aperture-core`.

## What It Does

`@aperture/claude-code`:

- receives Claude Code hook payloads
- translates those hook events into `SourceEvent`
- forwards them into an attached Aperture host such as `@aperture/runtime`
- maps `AttentionResponse` back into Claude Code hook responses

## Napkin

```text
+--------------+    +------------------+    +------------------+    +------------------+    +------------------+
| Claude Code  | -> |   @aperture/     | -> |   Aperture       | -> |   @aperture/     | -> | Claude Code      |
|  hooks       |    |   claude-code    |    |      core        |    |   claude-code    |    | hook decision    |
|  payloads    |    | translate facts  |    | judge attention  |    | translate reply  |    | returned         |
+--------------+    +------------------+    +------------------+    +------------------+    +------------------+

HTTP hook payloads    hook events          SourceEvent in        AttentionResponse     allow / deny / ask
and local hold loop   -> SourceEvent       AttentionView out     -> hook output         back to Claude Code
```

More explicitly:

```text
+--------------+    +------------------+    +------------------+    +------------------+
| Claude Code  | -> | Claude mapper    | -> | Aperture runtime | -> | Aperture core    |
| hooks        |    | explicit facts   |    | hold + route     |    | judgment only    |
+--------------+    +------------------+    +------------------+    +------------------+
        ^                                                                 |
        |                                                                 v
        +---------------- @aperture/claude-code response mapping <--------+
                           AttentionResponse -> Claude hook response
```

## Boundaries

Claude Code owns:

- hook emission
- tool execution
- local session behavior
- hook invocation lifecycle

Aperture owns:

- hook-event mapping into `SourceEvent`
- held approval behavior at the adapter boundary
- conservative fallback-to-ask when Aperture cannot hold or answer in time
- attention judgment
- operator-facing response routing

## Current Shape

The package currently includes:

- a mapping layer for Claude hook events
- a host-facing local hook server for hold-and-reply behavior
- permission-request mapping for Claude-native permission dialogs
- structured elicitation mapping for choice, form, reply, and URL-auth requests
- tool-aware risk hints for Bash, read, write, edit, and web-style tool calls
- mapping from `AttentionResponse` back into Claude hook responses

## Current Assessment

- `live`
  - this is a supported source adapter path
- `mature`
  - approvals, failure awareness, waiting awareness, and follow-up handoff are all part of the current documented path
- `bounded`
  - this package is intentionally centered on hook events, not transcript or session introspection

## Learn More

- [Claude Code Adapter](https://github.com/tomismeta/aperture/blob/main/docs/adapters/claude-code-adapter.md)
- [Adapter Contract](https://github.com/tomismeta/aperture/blob/main/docs/product/adapter-contract.md)
