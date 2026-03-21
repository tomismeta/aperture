# Claude Code Adapter

This document describes the Claude Code live source path for Aperture.

`@aperture/claude-code` translates Claude Code hook payloads into `SourceEvent` values and translates `AttentionResponse` values back into Claude Code hook responses.

In the current product shape, the intended operational path is:

- `@aperture/runtime` owns the live `ApertureCore`
- `@aperture/claude-code` feeds Claude hook events into that runtime
- `@aperture/tui` attaches as a surface

## Current Status

The Claude Code adapter is a real working capability on `main`.

Today, Aperture supports:

- Claude Code tool approval requests
- Claude Code permission-request dialogs
- Claude Code structured elicitation requests
- post-tool failure awareness
- non-blocking completion awareness
- waiting / input-needed awareness
- follow-up handoff when Claude ends a turn with a real question
- one shared Aperture runtime and one shared TUI across Claude Code and OpenCode
- local connection setup via:
  - `pnpm claude:connect --global`
  - `pnpm claude:disconnect --global`

The supported operator path is:

- `pnpm claude:connect --global`
- `pnpm aperture`
- restart Claude Code
- run `/hooks` once

## Connection Model

Claude Code stays source-specific at the setup boundary:

- Aperture writes Claude hook config
- Claude sends hook payloads into the shared Aperture runtime
- the TUI remains source-agnostic and does not own Claude connection setup

This is different from OpenCode because Claude's public integration seam is hook configuration rather than a server profile.

## What it supports today

- `PreToolUse` hook payloads
- `PermissionRequest` hook payloads
- `Elicitation` hook payloads
- `ElicitationResult` hook payloads
- `PostToolUseFailure` hook payloads
- `PostToolUse` hook payloads for non-blocking completion awareness
- `Notification` hook payloads for waiting/input handoff
- `UserPromptSubmit` hook payloads to clear waiting state
- `Stop` hook payloads for conversational follow-up handoff
- local HTTP hook server
- command-hook shim transport
- tool-aware risk hints for `Read` / `Write` / `Edit` / `WebSearch` / `Bash`
- schema-aware mapping from Claude elicitation into Aperture choice/form/reply flows

## What it does not support yet

- transcript parsing
- session or subagent lifecycle mapping

## Current shape

- mapping lives in [`packages/claude-code/src/mapping.ts`](../../packages/claude-code/src/mapping.ts)
- package exports live in [`packages/claude-code/src/index.ts`](../../packages/claude-code/src/index.ts)
- local HTTP hook server lives in [`packages/claude-code/src/server.ts`](../../packages/claude-code/src/server.ts)
- shared Aperture runtime lives in [`packages/runtime/src/runtime.ts`](../../packages/runtime/src/runtime.ts)
- optional TUI runtime client lives in [`packages/runtime/src/runtime-client.ts`](../../packages/runtime/src/runtime-client.ts)
- local runtime discovery lives in [`packages/runtime/src/runtime-discovery.ts`](../../packages/runtime/src/runtime-discovery.ts)
- local Claude adapter launcher lives in [`scripts/claude-adapter.ts`](../../scripts/claude-adapter.ts)
- local runtime launcher lives in [`scripts/runtime-server.ts`](../../scripts/runtime-server.ts)
- generic TUI launcher lives in [`scripts/aperture-tui.ts`](../../scripts/aperture-tui.ts)
- Claude forwarder lives in [`scripts/claude-forward.ts`](../../scripts/claude-forward.ts)

## Quickstart

This is the recommended full-stack Claude Code path:

```bash
git clone git@github.com:tomismeta/aperture.git
cd aperture
pnpm install
pnpm claude:connect --global
pnpm aperture
```

Step by step:

1. `git clone git@github.com:tomismeta/aperture.git`
   Download the Aperture repo to your machine.
2. `cd aperture`
   Enter the repo so the local scripts and package commands resolve correctly.
3. `pnpm install`
   Install the workspace dependencies.
4. `pnpm claude:connect --global`
   Write Aperture's Claude hook config into `~/.claude/settings.json`.
5. `pnpm aperture`
   Start the shared local Aperture stack: runtime, any configured adapters, and the TUI.

Then:

1. restart Claude Code
2. run `/hooks` once
3. use Claude normally

Most people only need that flow.

Everything below is the same setup broken into manual steps.

One-time setup:

Global:

```bash
pnpm claude:connect --global
```

- Write Aperture's Claude hook config into `~/.claude/settings.json`

Project-local setup instead:

```bash
pnpm claude:connect /path/to/project
```

- Write Aperture's Claude hook config into `.claude/settings.local.json` for a single repo

Daily use:

```bash
pnpm aperture
```

- Start the full local Aperture stack in one command

After connecting Claude for the first time, restart Claude Code and run `/hooks` once to confirm the hook set loaded.

To remove Aperture's Claude hook entries later:

```bash
pnpm claude:disconnect --global
```

By default:

- Claude hooks POST to `http://127.0.0.1:4545/hook`
- the TUI attaches to `http://127.0.0.1:4546/runtime`
- if no explicit runtime URL is set, the TUI auto-discovers live local Aperture runtimes from the local runtime registry

The connect command writes `.claude/settings.local.json` in the target project and preserves existing hooks. The generated command points at the local forwarder in this repo.

If you prefer to wire it manually, the resulting config shape is:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/aperture/node_modules/.bin/tsx\" \"/path/to/aperture/scripts/claude-forward.ts\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/aperture/node_modules/.bin/tsx\" \"/path/to/aperture/scripts/claude-forward.ts\""
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/aperture/node_modules/.bin/tsx\" \"/path/to/aperture/scripts/claude-forward.ts\""
          }
        ]
      }
    ],
    "Elicitation": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/aperture/node_modules/.bin/tsx\" \"/path/to/aperture/scripts/claude-forward.ts\""
          }
        ]
      }
    ],
    "ElicitationResult": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/aperture/node_modules/.bin/tsx\" \"/path/to/aperture/scripts/claude-forward.ts\""
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/aperture/node_modules/.bin/tsx\" \"/path/to/aperture/scripts/claude-forward.ts\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/aperture/node_modules/.bin/tsx\" \"/path/to/aperture/scripts/claude-forward.ts\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/aperture/node_modules/.bin/tsx\" \"/path/to/aperture/scripts/claude-forward.ts\""
          }
        ]
      }
    ]
  }
}
```

## Notes

- The forwarder reads the Claude hook payload from stdin and POSTs it to the local Aperture server.
- Claude's command-only hook events like `Elicitation` and `ElicitationResult` use the same command-hook forwarder path, so they still flow through the shared local adapter.
- The shared Aperture runtime owns `ApertureCore`; the Claude hook server is one ingress into it, and the TUI is an optional client surface.
- Claude Code and OpenCode share the same runtime and TUI; only their ingress and connection setup differ.
- Live Aperture runtimes register themselves locally so the TUI can detect what is up before it connects.
- If no surface is attached, `PreToolUse` approvals return `ask` immediately instead of waiting on the hold timeout.
- If a held approval times out, Aperture emits an ambient fallback note so the handoff back to Claude Code is visible.
- Claude frames are labeled with workspace basename plus a short session token so multiple Claude Code sessions are distinguishable in the TUI.
- Idle/input notifications show up as focused waiting status so you can see which Claude instance is blocked on you.
- Structured Claude elicitation can now surface as real TUI choice, form, reply, or auth-approval interactions instead of collapsing into status text.
- End-of-turn follow-up questions from Claude can surface through `Stop` when the assistant message actually looks like a question.
- `pnpm claude:connect --global` writes `~/.claude/settings.json`; the project-level command writes `.claude/settings.local.json`.
- `pnpm claude:disconnect --global` removes only Aperture's Claude hook commands and leaves unrelated Claude hooks alone.
- `Read`, `Grep`, `Glob`, `LS`, and web tools map to low risk; writes default to medium and escalate to high for sensitive paths.
- Bash commands still use pattern-based risk classification for destructive commands.
