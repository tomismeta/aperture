# Claude Code Adapter

`@aperture/claude-code` is an optional adapter for Aperture.

It translates Claude Code hook payloads into `ConformedEvent` values and translates `FrameResponse` values back into Claude Code hook responses.

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
- local Claude adapter launcher lives in [`scripts/claude-hook-server.ts`](../scripts/claude-hook-server.ts)
- local runtime launcher lives in [`scripts/runtime-server.ts`](../scripts/runtime-server.ts)
- generic TUI launcher lives in [`scripts/claude-hook-tui.ts`](../scripts/claude-hook-tui.ts)
- command-hook forwarder lives in [`scripts/claude-hook-forward.mjs`](../scripts/claude-hook-forward.mjs)

## Quickstart

This quickstart is for the second main Aperture use case:

- use the shared Aperture runtime, TUI, and Claude adapter to manage live Claude Code workload

1. Set up Claude hooks:

Global:

```bash
pnpm setup:claude-hook --global
```

Or for one project only:

```bash
pnpm setup:claude-hook /path/to/project
```

2. Start Aperture:

```bash
pnpm serve
```

3. In another terminal, start the Claude adapter:

```bash
pnpm claude:serve
```

4. In another terminal, open the TUI:

```bash
pnpm tui
```

5. Restart Claude Code, then run `/hooks` to confirm the hook set loaded.

By default:

- Claude hooks POST to `http://127.0.0.1:4545/hook`
- the TUI attaches to `http://127.0.0.1:4546/runtime`
- if no explicit runtime URL is set, the TUI auto-discovers live local Aperture runtimes from the local runtime registry

The setup command writes `.claude/settings.local.json` in the target project and preserves existing hooks. The generated command points at the local forwarder in this repo.

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
            "command": "node /path/to/aperture/scripts/claude-hook-forward.mjs"
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
            "command": "node /path/to/aperture/scripts/claude-hook-forward.mjs"
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
            "command": "node /path/to/aperture/scripts/claude-hook-forward.mjs"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/aperture/scripts/claude-hook-forward.mjs"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/aperture/scripts/claude-hook-forward.mjs"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/aperture/scripts/claude-hook-forward.mjs"
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
- `pnpm setup:claude-hook --global` writes `~/.claude/settings.json`; the project-level command writes `.claude/settings.local.json`.
- `Read`, `Grep`, `Glob`, `LS`, and web tools map to low risk; writes default to medium and escalate to high for sensitive paths.
- Bash commands still use pattern-based risk classification for destructive commands.
