# Claude Code Adapter

`@aperture/claude-code` is an optional adapter for [`@aperture/core`](../packages/core/src/index.ts).

It translates Claude Code hook payloads into `ApertureEvent` values and translates `FrameResponse` values back into Claude Code hook responses.

## What it supports today

- `PreToolUse` hook payloads
- `PostToolUseFailure` hook payloads
- local HTTP hook server
- Bash command consequence classification

## What it does not support yet

- `PermissionRequest`
- transcript parsing
- session or subagent lifecycle mapping
- default `Edit` / `Write` approval mapping
- command-hook shim transport

## Current shape

- mapping lives in [`packages/claude-code/src/index.ts`](../packages/claude-code/src/index.ts)
- local HTTP hook server lives in [`packages/claude-code/src/server.ts`](../packages/claude-code/src/server.ts)

## Demo

Run the synthetic Claude Code demo:

```bash
pnpm demo:claude-code
```
