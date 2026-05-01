# Aperture v0.4.1

`@tomismeta/aperture@0.4.1` is a product adapter-freshness patch release.

It keeps the `0.4.0` runtime, `/work` ingress contract, and bundled
`@tomismeta/aperture-core@0.7.0` judgment engine intact while refreshing the
host adapter layer against the latest supported harness surfaces.

## Highlights

- refreshes the generated Codex App Server protocol types
- maps newer Codex thread-goal, patch, MCP status, rate-limit, remote-control,
  model-verification, warning, and guardian-warning notifications
- updates OpenCode response routing to prefer the current session-scoped
  permission endpoint
- maps newer OpenCode session, todo, MCP, workspace, and worktree lifecycle
  events into the shared attention stream
- expands Claude Code hook coverage for safe lifecycle and status events,
  including setup, prompt expansion, tool batches, file-change awareness, and
  worktree lifecycle hooks
- keeps the new adapter code split into bounded mapper/parser modules instead
  of growing the existing adapter monoliths

## Why This Matters

This release keeps Aperture's shared operator surface current with the moving
agent-harness layer without changing the core product shape.

In practice that means:

- supported adapters send richer status and audit context into Aperture
- responses route back through newer host APIs where available
- Codex protocol drift is absorbed by generated types rather than hand-written
  guesses
- the deterministic core SDK remains stable for embedders

## What Did Not Change

This release does **not** change:

- the public `@tomismeta/aperture-core` SDK surface
- the host-neutral `/work` contract
- the default local runtime shape
- the product stance that Aperture is a shared review surface, not another
  agent host

## Validation

Validated with:

```bash
pnpm release:check
```

That includes typecheck, lint, formatting, dependency audit, contract/schema
checks, boundary and architecture checks, the full test suite, judgment battle,
SDK proof, and product smoke.

## Install

```bash
npm install -g @tomismeta/aperture
aperture
```

See:

- [Product README](../../packages/aperture/README.md)
- [Aperture v0.4.0](./aperture-v0.4.0.md)
- [Aperture Core SDK v0.7.0](./aperture-core-v0.7.0.md)
