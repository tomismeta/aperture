# Aperture v0.2.1

`@tomismeta/aperture@0.2.1` is a product patch release that expands Claude Code
hook coverage so Aperture sees more of the real session lifecycle without
changing the core SDK surface.

## Highlights

- expands the default Claude hook install set to include:
  - `SessionStart`
  - `InstructionsLoaded`
  - `PermissionDenied`
  - `SubagentStart`
  - `SubagentStop`
  - `TaskCreated`
  - `TaskCompleted`
  - `StopFailure`
  - `TeammateIdle`
  - `ConfigChange`
  - `CwdChanged`
  - `PreCompact`
  - `PostCompact`
  - `SessionEnd`
- adds adapter/runtime mapping for `ConfigChange` and `CwdChanged`
- improves Claude session continuity and ambient awareness in the live product
- keeps the hook/install story aligned with the adapter’s actual supported
  surface

## Why This Matters

Claude Code now tells Aperture more about what is happening around a session:

- when the session starts or ends
- when instructions or config change
- when Claude changes directories
- when teammate tasks and subagents start or stop
- when compaction or API failure changes session posture

That gives the local attention surface better continuity and more legible
session-state awareness without broadening Aperture’s product shape.

## What Did Not Change

This release does **not** change:

- `@tomismeta/aperture-core`
- the surfaced lane model
- the TUI contract
- the local-first product shape

It also still intentionally excludes:

- `FileChanged`
- `WorktreeCreate`
- `WorktreeRemove`

Those hooks either add likely noise or require behavior-replacing integration
instead of passive observation.

## Validation

Validated with:

```bash
pnpm exec tsx --test packages/claude-code/test/claude-code-adapter.test.ts packages/claude-code/test/claude-code-server.test.ts packages/aperture/test/claude-hooks.test.ts
pnpm typecheck
pnpm release:check
```

## Install

```bash
npm install -g @tomismeta/aperture
aperture
```

See:

- [Product README](../../packages/aperture/README.md)
- [Aperture v0.2.0](./aperture-v0.2.0.md)
- [Claude Code Adapter](../adapters/claude-code-adapter.md)
