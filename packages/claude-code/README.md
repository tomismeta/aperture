# `@aperture/claude-code`

The Claude Code adapter for Aperture.

This is a private workspace package, bundled into `@tomismeta/aperture` rather
than published as a separate npm adapter.

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
- permission-mode and transcript context on approval and auto-mode denial frames
- structured elicitation mapping for choice, form, reply, and URL-auth requests
- transcript-enriched `AskUserQuestion` mapping into Aperture choice/form requests
- a best-effort `AskUserQuestion` answer bridge that feeds Aperture selections back to Claude via hook context
- core-owned generic command-risk inference from preserved command summaries, with `classifyCommand` supplying a source risk hint/floor (not an override that can suppress core high consequence), plus source risk hints for read, write, edit, and web-style tools
- subagent lifecycle summaries with stable agent identity
- mapping from `AttentionResponse` back into Claude hook responses

Both `PreToolUse` and `PermissionRequest` preserve built-in Bash commands and
mark them with `toolFamily: "bash"` for core command-risk matching. Integrations
with custom command tools must likewise preserve command text and supply a known
command family (`bash`, `exec_command`, or `run_shell_command`), or provide an
explicit risk floor. Unknown-family text is not guaranteed command-specific
classification, and read/search content is not interpreted as command execution.

Command-risk API migration: `bashConsequence` is no longer exported.
`classifyToolRisk` may return `undefined` when no explicit command policy applies;
canonical consequence comes from core normalization, not an adapter fallback.

## Current Assessment

- `live`
  - this is a supported source adapter path
- `mature`
  - approvals, auto-mode denials, waiting awareness, and follow-up handoff are all part of the current documented path
- `bounded`
  - this package is intentionally centered on hook events, with selective transcript enrichment only where Claude's public hook payload is not sufficient on its own

## Learn More

- [Claude Code Adapter](https://github.com/tomismeta/aperture/blob/main/docs/adapters/claude-code-adapter.md)
- [Adapter Contract](https://github.com/tomismeta/aperture/blob/main/docs/product/adapter-contract.md)
