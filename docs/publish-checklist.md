# First Publish Checklist

This is the bar for the first public GitHub publish.

The goal is not broad feature coverage. The goal is a small repo that clearly proves the engine.

## What Must Be True

- the repo tells one story: `Aperture = engine-first attention middleware`
- the public package surface is clean and intentionally small
- `@aperture/core` remains adapter-agnostic
- adapters remain translation-only layers
- one real mixed-source workflow is runnable and understandable
- the engine can explain its decisions through trace output and scenario reports
- the docs match the code that actually ships
- the repo no longer contains stale dead packages or old demo surfaces

## Functional Gate

These commands should all work from the repo root:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm demo:tui
```

## Engine Gate

Before the first publish, the engine should be able to demonstrate:

- task-local deterministic coordination
- cross-source attention ordering through `AttentionView`
- behavioral quieting under overload
- critical-status rescue despite quieting
- sequence-aware behavior through `returned` and `attention_shifted`
- inspectable rationale and trace output

## Scope Gate

The first publish should not claim:

- production persistence
- mature API stability
- model-assisted reasoning
- anticipation beyond roadmap intent
- support for many adapters beyond the current Paperclip and Codex paths

## Publish Decision

The repo is ready to publish when:

1. the commands above are green
2. the mixed-source story is easy to understand from the README
3. the traced scenarios still look defensible after one final review pass
4. the mock Paperclip transport loop proves ingress and egress end to end

If any of those fail, keep iterating on the engine rather than broadening the project.
