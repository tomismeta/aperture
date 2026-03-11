# Claude Code Adapter

`@aperture/claude-code` is an optional adapter for [`@aperture/core`](../packages/core/src/index.ts).

It translates Claude Code hook payloads into `ConformedEvent` values and translates `FrameResponse` values back into Claude Code hook responses.

## What it supports today

- `PreToolUse` hook payloads
- `PostToolUseFailure` hook payloads
- optional `PostToolUse` mapping
- local HTTP hook server
- command-hook shim transport
- Bash command consequence classification
- generic approval mapping for non-Bash tools

## What it does not support yet

- `PermissionRequest`
- transcript parsing
- session or subagent lifecycle mapping
- tool-specific `Edit` / `Write` / `Read` consequence mapping

## Current shape

- mapping lives in [`packages/claude-code/src/index.ts`](../packages/claude-code/src/index.ts)
- local HTTP hook server lives in [`packages/claude-code/src/server.ts`](../packages/claude-code/src/server.ts)
- local Claude quickstart launcher lives in [`scripts/claude-hook-tui.ts`](../scripts/claude-hook-tui.ts)
- command-hook forwarder lives in [`scripts/claude-hook-forward.mjs`](../scripts/claude-hook-forward.mjs)

## Quickstart

Write Claude Code hook configuration into a target project:

```bash
pnpm setup:claude-hook /path/to/project
```

If you also want successful tool completions to show up as status updates:

```bash
pnpm setup:claude-hook /path/to/project --include-post-tool-use
```

Then start the local hook server and shared terminal attention surface:

```bash
pnpm demo:claude-hook
```

This listens on `http://127.0.0.1:4545/hook` by default and opens the TUI.

If you configured `PostToolUse` too, start the launcher with the matching environment flag:

```bash
APERTURE_INCLUDE_POST_TOOL_USE=1 pnpm demo:claude-hook
```

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
    ]
  }
}
```

If `APERTURE_INCLUDE_POST_TOOL_USE=1` is enabled, add a matching `PostToolUse` hook section too.

Restart Claude Code after editing settings, then use `/hooks` inside Claude Code to confirm the hooks loaded.

## Notes

- The forwarder reads the Claude hook payload from stdin and POSTs it to the local Aperture server.
- Claude frames are labeled with workspace basename plus a short session token so multiple Claude Code sessions are distinguishable in the TUI.
- Non-Bash tools are currently treated as generic blocking approvals with `medium` consequence.
- Bash commands still receive the only built-in high-risk classification.
