# F-Stop Architecture

This note defines the cleaner target architecture for F-Stop.

The goal is simple:

- small public surface
- deterministic execution
- local-file inputs
- unattended VPS operation
- one human-readable report at the end

## Product Shape

F-Stop should present as a simple solution:

1. ingest a file
2. run deterministic replay through Aperture Core
3. review disagreements with an agent backend
4. freeze only strong candidate disagreements
5. attempt a bounded code improvement
6. emit one report with findings and recommendations

The internal machinery can stay sophisticated, but the operator story should
feel like:

```bash
pnpm lab:fstop:run --file /absolute/path/to/input --provider openclaw --json
```

## Design Rules

1. Aperture Core stays deterministic and local.
2. Agent backends stay outside the hot path.
3. F-Stop owns replay, scoring, gating, artifacts, and telemetry.
4. Runtime artifacts live under `.aperture/lab`, not inside the repo tree.
5. Operators should only need a handful of commands.
6. The final output should be one report, not a maze of artifact files.

## Public Commands

Normal operator commands:

- `pnpm lab:fstop:ingest`
- `pnpm lab:fstop:run`
- `pnpm lab:fstop:sweep`
- `pnpm lab:fstop:campaign`
- `pnpm lab:fstop:service`
- `pnpm lab:fstop:gc`

Everything else is an implementation or debugging lane.

## Runtime Layers

### 1. Canonical Input

The preferred input file is `*.fstop-session.json`.

That file is:

- local-first
- replay-oriented
- stable enough to hand between ingest, replay, and review

Raw exports are convenience inputs. They should normalize into canonical
F-Stop Session files before replay.

### 2. Replay

Canonical session files compile into replay bundles, which run through the real
`ApertureCore` implementation.

This is the important invariant:

- agents do not simulate Aperture
- the harness replays real `SourceEvent`s through real Core code

### 3. Review

The harness prepares a bounded review artifact and prompt.
An agent backend returns structured review judgments.
The harness compares those judgments against deterministic replay output.

### 4. Calibration

Disagreements are only candidate signals at first.
They become calibration truth only after stronger ratification, such as:

- repeated agreement across reruns
- repeated agreement across multiple sessions
- future human acceptance

This keeps "reviewer opinion" separate from "frozen truth".

### 5. Proposal

Strong candidate signals produce:

- intent statements
- code recommendations
- optional patch artifacts

The harness still owns:

- evaluation
- invariant checks
- release checks
- artifact persistence

### 6. Campaign / Service

Campaigns and services should use isolated git worktrees instead of repeated
full clones.

They should produce:

- `status.json`
- `campaign.log`
- `summary.jsonl`
- `current-report.json`
- `current-report.md`

## Directory Model

The runtime root should be quiet and predictable:

```text
.aperture/lab/
  sessions/
  bundles/
  calibration/
  campaigns/
    current-campaign/
    <campaign-id>/
  results/
  service/
```

The repo should contain code, docs, and a small amount of authored fixture
data, not large runtime churn.

## Final Report Contract

Every unattended run should end with one synthesized report that includes:

- run summary
- dataset / file coverage
- session count
- replay step count
- major disagreement clusters
- promoted candidate cases
- intent statements
- code recommendations
- patch summary, if any
- gate results
- final recommendation

This report should be the default human entrypoint.

## What Still Needs To Shrink

The next simplification targets are:

1. split importer adapters by source
2. split offline review into `prepare`, `prompt`, `parse`, `compare`, and `validate`
3. keep CLI scripts thin and push orchestration into `packages/lab/src`
4. reduce tracked public corpus blobs in git
5. add stronger truth-ratification rules before freezing reviewer disagreements

## End State

F-Stop should be a complicated system that presents itself simply:

- point it at a file or dataset
- let it run unattended
- watch one status file
- read one report
- review one bounded proposal
