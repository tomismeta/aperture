# Claude Code Adapter

`@aperture/claude-code` is an optional adapter for Aperture.

It translates Claude Code hook payloads into `ConformedEvent` values and translates `AttentionResponse` values back into Claude Code hook responses.

In the current product shape, the intended operational path is:

- `@aperture/runtime` owns the live `ApertureCore`
- `@aperture/claude-code` feeds Claude hook events into that runtime
- `@aperture/tui` attaches as a surface

## What it supports today

- `PreToolUse` hook payloads
- `PostToolUseFailure` hook payloads
- `PostToolUse` hook payloads for non-blocking completion awareness
- `Notification` hook payloads for waiting/input handoff
- `UserPromptSubmit` hook payloads to clear waiting state
- `Stop` hook payloads for conversational follow-up handoff
- local HTTP hook server
- command-hook shim transport
- tool-aware risk hints for `Read` / `Write` / `Edit` / `WebSearch` / `Bash`

## What it does not support yet

- `PermissionRequest`
- transcript parsing
- session or subagent lifecycle mapping

## Current shape

- mapping lives in [`packages/claude-code/src/index.ts`](../packages/claude-code/src/index.ts)
- local HTTP hook server lives in [`packages/claude-code/src/server.ts`](../packages/claude-code/src/server.ts)
- shared Aperture runtime lives in [`packages/runtime/src/runtime.ts`](../packages/runtime/src/runtime.ts)
- optional TUI runtime client lives in [`packages/runtime/src/runtime-client.ts`](../packages/runtime/src/runtime-client.ts)
- local runtime discovery lives in [`packages/runtime/src/runtime-discovery.ts`](../packages/runtime/src/runtime-discovery.ts)
- local Claude adapter launcher lives in [`scripts/claude-adapter.ts`](../scripts/claude-adapter.ts)
- local runtime launcher lives in [`scripts/runtime-server.ts`](../scripts/runtime-server.ts)
- generic TUI launcher lives in [`scripts/aperture-tui.ts`](../scripts/aperture-tui.ts)
- Claude forwarder lives in [`scripts/claude-forward.ts`](../scripts/claude-forward.ts)

## Quickstart

This quickstart is for the second main Aperture use case:

- use the shared Aperture runtime, TUI, and Claude adapter to manage live Claude Code workload

This is the single recommended quickstart path.

Start here:

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
   Start the default local Aperture stack: runtime, Claude adapter, and TUI.

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
- The shared Aperture runtime owns `ApertureCore`; the Claude hook server is one ingress into it, and the TUI is an optional client surface.
- Live Aperture runtimes register themselves locally so the TUI can detect what is up before it connects.
- If no surface is attached, `PreToolUse` approvals return `ask` immediately instead of waiting on the hold timeout.
- If a held approval times out, Aperture emits an ambient fallback note so the handoff back to Claude Code is visible.
- Claude frames are labeled with workspace basename plus a short session token so multiple Claude Code sessions are distinguishable in the TUI.
- Idle/input notifications show up as focused waiting status so you can see which Claude instance is blocked on you.
- End-of-turn follow-up questions from Claude can surface through `Stop` when the assistant message actually looks like a question.
- `pnpm claude:connect --global` writes `~/.claude/settings.json`; the project-level command writes `.claude/settings.local.json`.
- `pnpm claude:disconnect --global` removes only Aperture's Claude hook commands and leaves unrelated Claude hooks alone.
- `Read`, `Grep`, `Glob`, `LS`, and web tools map to low risk; writes default to medium and escalate to high for sensitive paths.
- Bash commands still use pattern-based risk classification for destructive commands.
