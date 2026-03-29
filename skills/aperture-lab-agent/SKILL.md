---
name: aperture_lab_agent
description: Run Aperture Lab F-Stop's provider-neutral runtime loop. Use when operating the self-hosted reviewer/optimizer harness against OpenClaw, Hermes, or another compatible runtime through the canonical lab:fstop:* commands.
metadata: {"openclaw":{"requires":{"bins":["pnpm"]},"os":["linux","darwin"]}}
---

# Aperture Lab F-Stop Runtime

Use this skill when the goal is to run Aperture Lab F-Stop as a **self-hosted
runtime harness**, not when working on the live product path.

The canonical command surface is provider-neutral:

- `pnpm lab:fstop:run --provider <provider> --reviewer-provider <provider> --optimizer-provider <provider> ...`
- `pnpm lab:fstop:review --reviewer-provider <provider> ...`
- `pnpm lab:fstop:propose --reviewer-provider <provider> --optimizer-provider <provider> ...`
- `pnpm lab:fstop:optimize --provider <provider> ...`
- `pnpm lab:fstop:reviewer --provider <provider>`
- `pnpm lab:fstop:optimizer --provider <provider>`

Supported providers today:

- `openclaw`
- `hermes`
- `generic`

Provider-specific shortcuts such as `lab:fstop:openclaw` are conveniences, not
the core product surface.

## Load First

Read:

- `packages/lab/research/autoresearch-program.md`
- `packages/lab/research/autoresearch-config.json`

These define:

- allowed edit paths
- forbidden edit paths
- artifact flow
- promotion rules
- optimizer output contract

## Main Rule

Keep AI out of the hot path.

This harness may:

- run the top-level agent-managed loop
- import public trajectories
- run offline review and disagreement capture
- promote repeated high-confidence disagreements
- optimize against the frozen calibration corpus
- return a reviewable proposal artifact

It must not:

- change live runtime behavior to depend on AI
- edit outside the allowed semantic/importer surface
- auto-merge code

## Product Surface

Treat `lab:fstop:*` as the only supported CLI namespace.
