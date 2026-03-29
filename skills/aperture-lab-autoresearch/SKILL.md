---
name: aperture_lab_autoresearch
description: Run Aperture Lab F-Stop on imported public trajectories, prepare review artifacts, compare disagreements, and propose bounded semantic-layer improvements under strict replay gates.
metadata: {"openclaw":{"requires":{"bins":["pnpm"]},"os":["linux","darwin"]}}
---

# Aperture Lab F-Stop

Use this skill when the task is to run Aperture's **offline semantic
improvement loop** on a remote worker or long-running harness.

This skill is only for the **Lab path**.

Do not use it for live runtime behavior or product-surface work.

## Load First

Before doing anything else, read:

- `packages/lab/research/autoresearch-program.md`
- `packages/lab/research/autoresearch-config.json`

Those files are the source of truth for:

- allowed edit paths
- forbidden edit paths
- evaluation commands
- artifact chain
- expected outcomes
- non-goals

Follow them strictly.

## Main Rule

Keep AI out of the hot path.

This loop may:

- import public trajectories
- prepare offline review artifacts
- run reviewer responses into disagreements and recommendation summaries
- promote selected disagreements into a frozen calibration corpus
- evaluate that corpus repeatably
- propose bounded semantic/importer changes
- run replay and release gates

This loop must not:

- change the live decision path to depend on AI
- edit planner or continuity logic
- auto-merge

## Core Commands

Use the provider-neutral `lab:fstop:*` surface as the default operating path:

```bash
pnpm lab:fstop:run --provider <provider> --reviewer-provider <provider> --optimizer-provider <provider> --json
APERTURE_OPENCLAW_REVIEW_TIMEOUT=60 pnpm lab:fstop:review --dataset swe-smith --split tool --limit 3 --reviewer-provider <provider> --json
pnpm lab:fstop:propose --reviewer-provider <provider> --optimizer-provider <provider> --json
pnpm lab:fstop:cycle --json
pnpm lab:fstop:optimize --provider <provider> --json
pnpm judgment:battle
pnpm release:check
```

For the default short OpenClaw agent-run command, use:

```bash
pnpm lab:fstop:openclaw
```

If you need to debug one bundle manually, fall back to:

```bash
pnpm trajectory:import --dataset swe-smith --split tool --limit 3
pnpm lab:fstop:prepare --bundle <bundle-path> --json
pnpm lab:fstop:review:run --artifact <artifact-path> --reviewer-command "pnpm lab:fstop:reviewer --provider <provider>" --json
```

To freeze reviewer-backed disagreements into the repeatable optimization
surface, use:

```bash
pnpm lab:fstop:promote --report <report-path> --split train --json
pnpm lab:fstop:evaluate --json
pnpm lab:fstop:cycle --json
```

Use the discovery loop to find candidate problems.

Use the frozen calibration loop to judge whether a patch actually helped.

The canonical reviewer adapter is:

```bash
pnpm lab:fstop:reviewer --provider <provider>
```

Supported providers:

- `hermes`
- `openclaw`
- `generic`

The adapter resolves the actual provider command from:

- `APERTURE_HERMES_REVIEWER_COMMAND`
- `APERTURE_OPENCLAW_REVIEWER_COMMAND`
- `APERTURE_REVIEWER_COMMAND`

For OpenClaw, the adapter can also invoke the local `openclaw` binary directly
when no override command is configured. Use these env vars to tune that path:

- `APERTURE_OPENCLAW_BIN`
- `APERTURE_OPENCLAW_AGENT`
- `APERTURE_OPENCLAW_REVIEW_SESSION_ID`
- `APERTURE_OPENCLAW_REVIEW_THINKING`
- `APERTURE_OPENCLAW_REVIEW_TIMEOUT`

By default it uses a fresh OpenClaw session id per review and avoids the shared
`main` agent session unless `APERTURE_OPENCLAW_AGENT` is explicitly set.

The underlying reviewer command must:

- read the reviewer prompt on stdin
- write valid JSON to stdout
- exit non-zero on failure

If the provider supports skills, use the dedicated reviewer role:

- `skills/aperture-lab-reviewer/SKILL.md`

For the code-editing phase, use the dedicated optimizer role:

- `skills/aperture-lab-optimizer/SKILL.md`

The canonical optimizer adapter is:

```bash
pnpm lab:fstop:optimizer --provider <provider>
```

It resolves provider-specific optimizer commands from:

- `APERTURE_HERMES_OPTIMIZER_COMMAND`
- `APERTURE_OPENCLAW_OPTIMIZER_COMMAND`
- `APERTURE_OPTIMIZER_COMMAND`

For OpenClaw, the adapter can also invoke the local `openclaw` binary directly
when no override command is configured. Use these env vars to tune that path:

- `APERTURE_OPENCLAW_BIN`
- `APERTURE_OPENCLAW_OPTIMIZER_AGENT`
- `APERTURE_OPENCLAW_OPTIMIZER_SESSION_ID`
- `APERTURE_OPENCLAW_OPTIMIZER_THINKING`
- `APERTURE_OPENCLAW_OPTIMIZER_TIMEOUT`

The unattended optimizer entrypoint is:

```bash
pnpm lab:fstop:optimize --provider <provider> --json
```

It should be run from a clean worktree.

The unattended proposal entrypoint is:

```bash
pnpm lab:fstop:propose --reviewer-provider <provider> --optimizer-provider <provider> --json
```

Prefer this when the worker should go all the way from:

- discovery batch
- to repeated-signal selection
- to candidate calibration promotion
- to a reviewable patch proposal

The unattended top-level runner entrypoint is:

```bash
pnpm lab:fstop:run --provider <provider> --reviewer-provider <provider> --optimizer-provider <provider> --json
```

Prefer this when the provider should manage repeated proposal slices on its own
instead of waiting for manual slice selection.

## Output Expectations

Good runs should produce:

- review artifacts under `packages/lab/results/offline-review/requests`
- reviewer-filled artifacts under `packages/lab/results/offline-review/responses`
- reviewer prompts under `packages/lab/results/offline-review/prompts`
- raw reviewer outputs under `packages/lab/results/offline-review/raw`
- disagreement reports under `packages/lab/results/offline-review/disagreements`
- recommendation summaries under `packages/lab/results/offline-review/recommendations`
- run summaries under `packages/lab/results/offline-review/runs`
- calibration cases under `packages/lab/calibration`
- calibration reports under `packages/lab/results/autoresearch/evaluations`
- optimization briefs under `packages/lab/results/autoresearch/briefs`
- optimizer prompts, raw outputs, patches, and run summaries under `packages/lab/results/autoresearch/optimizer`
- proposal artifacts under `packages/lab/results/autoresearch/proposals`
- candidate bounded code changes only on the allowed edit surface
- a clear pass/fail result from the gates

## Artifact Chain

Execute the loop in this order:

1. input bundle
2. Aperture replay output
3. prepared review artifact
4. reviewer prompt
5. raw reviewer output
6. reviewer-filled artifact
7. disagreement report
8. recommendation summary
9. promoted calibration case
10. frozen calibration evaluation report
11. optimization brief
12. optimizer prompt
13. raw optimizer output
14. proposal artifact
15. optional bounded patch proposal
16. gated evaluation result

## Optimization Target

Optimize for:

- better title extraction
- better summary extraction
- better semantic frame reads
- better tool-family reads
- better consequence-band reads

Do not optimize for:

- general product UX
- continuity behavior
- route churn for its own sake

## When In Doubt

Prefer:

- narrower edits
- stronger replay safety
- frozen calibration evidence over one-off reviewer disagreements
- better disagreement artifacts

over:

- aggressive autonomous rewriting
- speculative planner changes
- touching unrelated repo areas
