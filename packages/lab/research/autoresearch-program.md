# Aperture Lab F-Stop Program

This file is the **repo-local contract** for running the offline Lab loop on a
remote harness such as a long-running VPS worker.

It is intentionally versioned in the repo instead of living only in a global
Codex skill, because the remote worker should execute against the same
instructions, boundaries, and gates as the repository itself.

## Naming

The discovery, review, recommendation, and proposal subsystem inside Aperture
Lab is called **F-Stop**.

The canonical user-facing CLI surface for F-Stop is:

- `lab:fstop:ingest`
- `lab:fstop:campaign`
- `lab:fstop:service`
- `lab:fstop:run`
- `lab:fstop:gc`

The remaining commands are lower-level debugging and adapter entrypoints:

- `lab:fstop:review`
- `lab:fstop:reviewer`
- `lab:fstop:runner`
- `lab:fstop:propose`
- `lab:fstop:optimize`
- `lab:fstop:optimizer`

These commands are provider-neutral and should be the only public entry surface
for OpenClaw, Hermes, and future compatible runtimes.

For long unattended work, prefer `lab:fstop:campaign`. It manages repeated
isolated worktree windows with shared dependencies and writes live campaign
status under `.aperture/lab/campaigns`.

For service-style unattended operation with restart and stall handling, prefer
`lab:fstop:service`.

For cleanup and quiet VPS hygiene, use `lab:fstop:gc`.

## Main Rule

Use AI and autonomous search **only in the offline Lab loop**.

Do not put AI in the hot path.

The live system must remain:

- deterministic
- replayable
- inspectable
- bounded

## Objective

Improve:

- public trajectory mapping
- semantic interpretation quality
- semantic discoverability quality
- frozen calibration corpus quality

using imported public trajectories and disagreement reports.

Do not optimize:

- planner logic
- continuity rules
- product-shell behavior
- runtime hosting

in this loop.

## Inputs

The harness should operate on:

- canonical session files in `.aperture/lab/sessions`
- imported public bundles in `.aperture/lab/bundles/public`
- raw-ingested bundles in `.aperture/lab/bundles/raw`
- explicit local bundle files passed via `pnpm lab:fstop:run --file <path>` or `pnpm lab:fstop:propose --file <path>`
- prepared review artifacts in `.aperture/lab/results/offline-review/requests`
- reviewer prompts in `.aperture/lab/results/offline-review/prompts`
- raw reviewer outputs in `.aperture/lab/results/offline-review/raw`
- reviewer-filled artifacts in `.aperture/lab/results/offline-review/responses`
- disagreement reports in `.aperture/lab/results/offline-review/disagreements`
- recommendation summaries in `.aperture/lab/results/offline-review/recommendations`
- run summaries in `.aperture/lab/results/offline-review/runs`
- campaign status in `.aperture/lab/current-campaign/status.json`
- current final report links in:
  - `.aperture/lab/current-campaign/current-report.json`
  - `.aperture/lab/current-campaign/current-report.md`
- existing authored and held-out Lab fixtures
- promoted calibration cases in `packages/lab/calibration`
- calibration reports in `.aperture/lab/results/autoresearch/evaluations`
- optimization briefs in `.aperture/lab/results/autoresearch/briefs`

## Allowed Edit Surface

The harness may propose changes only in:

- `packages/lab/src/public-trajectories.ts`
- `packages/core/src/semantic-detection.ts`
- `packages/core/src/semantic-interpreter.ts`
- `packages/core/src/semantic-language.ts`
- `packages/lab/src/offline-review.ts`

The purpose is to keep the search surface narrow and directly tied to semantic
quality.

## Forbidden Edit Surface

The harness must not edit:

- `packages/core/src/attention-planner.ts`
- `packages/core/src/aperture-core.ts`
- `packages/runtime/**`
- `packages/aperture/**`
- `packages/tui/**`
- `packages/paperclip/**`
- release notes or version files

Those belong to other tranches and would create overfitting risk.

## Operating Loop

There are **two loops**.

- **Discovery loop**
  - uses imported public trajectories plus the reviewer model
  - allowed to be noisy
  - finds candidate disagreements worth promotion
- **Optimization loop**
  - uses only the frozen promoted calibration corpus
  - should be repeatable
  - is the actual score surface for bounded code changes

Do not optimize directly against raw reviewer noise.

### 1. Import

Import new public trajectories:

```bash
pnpm trajectory:import --dataset swe-smith --split tool --limit 5
```

### 2. Prepare

Prepare one or more bundles for review:

```bash
pnpm lab:fstop:prepare --bundle <bundle-path>
```

### 3. Review

Use an offline reviewer model to fill the generated review artifacts.

The reviewer should focus first on:

- title extraction
- summary extraction
- event status
- semantic intent frame
- tool family
- consequence band

### 4. Run

Use one unattended command to render the prompt, invoke the reviewer model,
capture its raw stdout, write the completed artifact, write the disagreement
report, write the recommendation summary, and append the results log:

```bash
pnpm lab:fstop:review:run --artifact <artifact-path> --reviewer-command "pnpm lab:fstop:reviewer --provider <provider>" --json
```

The canonical reviewer adapter is:

```bash
pnpm lab:fstop:reviewer --provider <provider>
```

Supported providers:

- `hermes`
- `openclaw`
- `generic`

The adapter resolves the underlying provider command from environment variables:

- `APERTURE_HERMES_REVIEWER_COMMAND`
- `APERTURE_OPENCLAW_REVIEWER_COMMAND`
- `APERTURE_REVIEWER_COMMAND`

For OpenClaw specifically, the adapter can also run directly against the
installed `openclaw` binary when no override command is configured. The
following environment variables tune that built-in path:

- `APERTURE_OPENCLAW_BIN`
- `APERTURE_OPENCLAW_AGENT`
- `APERTURE_OPENCLAW_REVIEW_SESSION_ID`
- `APERTURE_OPENCLAW_REVIEW_THINKING`
- `APERTURE_OPENCLAW_REVIEW_TIMEOUT`

By default the adapter uses a fresh OpenClaw session id for each review and
does not reuse the shared `main` agent session unless `APERTURE_OPENCLAW_AGENT`
is explicitly set.

The underlying reviewer command must:

- read the prompt on stdin
- write JSON to stdout
- exit non-zero on failure

The `run` command is the main unattended handoff point for Hermes/OpenClaw:

- it renders the reviewer-model prompt
- executes the reviewer command
- writes the raw reviewer stdout
- writes the completed review artifact
- emits the disagreement report
- emits the recommendation summary
- emits a run summary with stable artifact paths
- appends one row to the TSV results log
- returns machine-readable JSON to stdout

Use `prompt` and `compare` only for debugging or manual inspection.

For repeated remote-worker operation, prefer the batch wrapper:

```bash
pnpm lab:fstop:review --dataset swe-smith --split tool --limit 3 --reviewer-provider <provider> --json
```

This is the cleanest entrypoint for the VPS runner because it imports bundles,
executes the per-bundle review loop, and writes an aggregate report artifact in
one pass.

For a short operator-facing default on the box, use:

```bash
pnpm lab:fstop:openclaw
```

For the highest-autonomy top-level run, use:

```bash
pnpm lab:fstop:run --provider <provider> --reviewer-provider <provider> --optimizer-provider <provider> --json
```

This lets the provider-managed runner try repeated proposal slices until it
either finds a reviewable proposal with a patch artifact or exhausts the slice
budget.

If the goal is to go all the way from discovery to a reviewable patch proposal,
prefer the unattended proposal loop:

```bash
pnpm lab:fstop:propose --reviewer-provider <provider> --optimizer-provider <provider> --json
```

This command should:

- run a discovery batch
- tolerate reviewer errors per bundle instead of aborting the whole run
- cluster repeated high-confidence disagreements
- promote only those repeated signals into an ignored candidate calibration corpus
- run the optimizer against the committed corpus plus the candidate corpus
- emit a reviewable proposal artifact and optional patch artifact

The canonical runner adapter is:

```bash
pnpm lab:fstop:runner --provider <provider>
```

Supported providers:

- `hermes`
- `openclaw`
- `generic`

The adapter resolves provider-specific runner commands from:

- `APERTURE_HERMES_RUNNER_COMMAND`
- `APERTURE_OPENCLAW_RUNNER_COMMAND`
- `APERTURE_RUNNER_COMMAND`

For OpenClaw specifically, the adapter can also invoke the local `openclaw`
binary directly when no override command is configured. Use these environment
variables to tune that built-in path:

- `APERTURE_OPENCLAW_BIN`
- `APERTURE_OPENCLAW_RUNNER_AGENT`
- `APERTURE_OPENCLAW_RUNNER_SESSION_ID`
- `APERTURE_OPENCLAW_RUNNER_THINKING`
- `APERTURE_OPENCLAW_RUNNER_TIMEOUT`

### Optimizer Output Contract

The optimizer model must return exactly one JSON object, not prose.

The optimizer must not create commits or switch branches during a run. Leave
surviving changes in the worktree so the harness can capture a reviewable patch
artifact directly.

Required fields:

- `action`: `patched` or `no_patch`
- `summary`
- `reasons`
- `recommendedFiles`
- `changedFiles`
- `commandsRun`

Preferred fields when known:

- `beforeMismatchCount`
- `afterMismatchCount`
- `judgmentBattle`: `pass`, `fail`, or `not_run`
- `releaseCheck`: `pass`, `fail`, or `not_run`

If no patch survives, the optimizer must still return a structured `no_patch`
result with concrete blockers and likely target files. A vague freeform answer
is not sufficient for the unattended loop.

### 4. Promote

Promote only high-confidence disagreements into the frozen calibration corpus:

```bash
pnpm lab:fstop:promote --report <report-path> --split train --json
```

Promotion captures:

- corrected expectations from promoted disagreements
- limited same-step invariants so nearby classifications do not drift silently
- target files for the likely remediation area

### 5. Evaluate

Evaluate the frozen calibration corpus against the current `aperture-core` and
importer logic:

```bash
pnpm lab:fstop:evaluate --json
```

This reruns the stored bundles through current core and measures:

- corrected mismatches remaining
- invariant mismatches introduced
- mismatch counts by focus area

### 6. Cycle

Generate a runner-facing optimization brief from the frozen corpus:

```bash
pnpm lab:fstop:cycle --json
```

This writes:

- a calibration evaluation report
- a markdown summary
- a JSON optimization brief
- a markdown optimization brief

The VPS runner should use the optimization brief as the input for bounded code
changes.

### 7. Optimize

Only after a non-clean optimization brief exists, propose bounded code changes
on the allowed edit surface.

The goal is:

- reduce corrected mismatches
- keep invariant mismatches at zero

Use the canonical optimizer adapter:

```bash
pnpm lab:fstop:optimizer --provider <provider>
```

Supported providers:

- `hermes`
- `openclaw`
- `generic`

The adapter resolves provider-specific optimizer commands from:

- `APERTURE_HERMES_OPTIMIZER_COMMAND`
- `APERTURE_OPENCLAW_OPTIMIZER_COMMAND`
- `APERTURE_OPTIMIZER_COMMAND`

For OpenClaw specifically, the adapter can also invoke the local `openclaw`
binary directly when it is available on `PATH`. Use these environment variables
to tune the built-in OpenClaw optimizer path:

- `APERTURE_OPENCLAW_BIN`
- `APERTURE_OPENCLAW_OPTIMIZER_AGENT`
- `APERTURE_OPENCLAW_OPTIMIZER_SESSION_ID`
- `APERTURE_OPENCLAW_OPTIMIZER_THINKING`
- `APERTURE_OPENCLAW_OPTIMIZER_TIMEOUT`

The unattended VPS entrypoint for the full optimization pass is:

```bash
pnpm lab:fstop:optimize --provider <provider> --json
```

This command should:

- require a clean worktree before it starts
- regenerate the frozen calibration report and optimization brief
- render the optimizer prompt
- run the optimizer provider against that prompt
- inspect the changed files
- reject edits outside the allowed surface
- rerun the frozen calibration evaluation
- rerun judgment and release gates
- write a machine-readable optimizer run artifact
- append the optimizer TSV log

The unattended VPS entrypoint for the full discovery-to-proposal pass is:

```bash
pnpm lab:fstop:propose --reviewer-provider <provider> --optimizer-provider <provider> --json
```

This command should:

- require a clean worktree before it starts
- run the discovery batch
- keep partial results when one reviewer response is malformed
- promote only repeated high-confidence signals
- run the optimizer on the allowed edit surface
- emit a proposal artifact with:
  - selected signals
  - promoted cases
  - optimizer run path
  - optional patch path
  - before/after mismatch counts

### 8. Gate

Every patch must pass:

```bash
pnpm exec tsx --test packages/lab/test/autoresearch-calibration.test.ts packages/lab/test/offline-review.test.ts packages/lab/test/public-trajectories.test.ts
pnpm lab:fstop:evaluate --json
pnpm judgment:battle
pnpm release:check
```

## Expected Outcome

The expected outcome is **not** “the model rewrites Aperture.”

The expected outcome is:

- better extracted titles and summaries from public trajectories
- fewer obvious semantic misreads on imported external cases
- a growing disagreement corpus that reflects real outside pressure
- a bounded optimization loop that improves semantics faster than manual edits alone
- no regressions in determinism or release checks

Over time, success should look like:

- fewer high-confidence disagreements per import batch
- better held-out performance
- a stronger corpus for future autoresearch passes

## Artifact Chain

The remote harness should treat the loop as a fixed artifact chain:

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
12. optional bounded patch proposal
13. gated evaluation result

For productized unattended operation, the primary entrypoint should be:

- `pnpm lab:fstop:run --provider <provider> --reviewer-provider <provider> --optimizer-provider <provider> --file <bundle-or-batch-or-raw-export> --json`

That direct-file mode should emit:

- one synthesized final report JSON + Markdown
- intent statements describing the sustainable semantic change
- code recommendations describing the suggested files and reasoning
- major disagreement summaries
- coverage and run-count summaries
- optional patch artifacts when the optimizer leaves a durable diff

The direct-file path may ingest the file first when it is a supported raw
export instead of an already-compiled bundle or precomputed batch report.

The preferred standard input is a canonical F-Stop Session JSON file. Raw
exports should normalize into that shape before they become replay bundles.

Campaign and service runs should keep `current-report.json` and
`current-report.md` updated to point at the latest synthesized report.

## Run History

Treat the JSON run artifacts and synthesized current report as the source of
truth for unattended history. Do not maintain parallel TSV logs.

Useful fields in a run artifact include:

- provider
- status
- mismatch deltas
- changed-file counts
- gate outcomes
- paths to the prompt, raw output, and run summary

The runner may orchestrate the whole chain, but the gates decide whether a
patch survives.

## Why This Is Better Than A Global Skill

A global skill can still be useful for an operator-facing Codex agent, but the
first-class mechanism for the VPS harness should be this repo-local program.

Why:

- versioned with the code
- reviewable in git
- easy to run on any worker
- independent of one user’s Codex home directory
- explicit about edit boundaries and gates

If we later want a Codex skill, it should point to this program rather than
replace it.

## Reviewer Skill

If the reviewer provider supports skills, prefer the dedicated reviewer role:

- `skills/aperture-lab-reviewer/SKILL.md`

That skill is for the reviewer model only.

The runner/orchestrator should keep using:

- `skills/aperture-lab-autoresearch/SKILL.md`
- `skills/aperture-lab-agent/SKILL.md`
- `skills/aperture-lab-runner/SKILL.md`

For actual code-editing passes, prefer the dedicated optimizer role:

- `skills/aperture-lab-optimizer/SKILL.md`
