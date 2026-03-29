# Offline AI Review Loop

This note defines how Aperture Lab should use AI to improve the semantic and
deterministic path without putting AI in the hot path.

It is a Lab operations note, not a product-surface note.

The named discovery and proposal subsystem inside Aperture Lab is **F-Stop**.

The canonical user-facing CLI surface for this loop is provider-neutral:

- `pnpm lab:fstop:run ...`
- `pnpm lab:fstop:review ...`
- `pnpm lab:fstop:reviewer --provider <provider>`
- `pnpm lab:fstop:propose ...`
- `pnpm lab:fstop:optimize --provider <provider>`
- `pnpm lab:fstop:optimizer --provider <provider>`

## Main Rule

AI belongs in the **offline improvement loop**.

AI does **not** belong in the live judgment path.

That means:

- `@tomismeta/aperture-core` stays deterministic
- runtime and product surfaces stay deterministic
- replay, review, disagreement analysis, and optimization can use AI offline

The goal is:

- better semantic interpretation
- better discoverability of decisions
- better replay corpora
- stronger held-out evaluation

without making the live engine model-dependent.

## Why This Exists

Synthetic scenarios and harvested local sessions are both valuable, but they do
not cover the full variety of public agent trajectories or the full space of
semantic mistakes.

Public trajectory import gives Lab outside pressure.

AI review gives Lab a scalable way to:

- inspect imported cases
- suggest likely correct semantic readings
- identify disagreement between Aperture and a reviewer model
- rank which disagreements are worth promotion into curated fixtures

This should be treated as another Lab lane:

- authored golden scenarios
- harvested local sessions
- imported public trajectories
- AI-reviewed disagreement artifacts
- frozen promoted calibration cases

## Operating Principle

Use AI as:

- reviewer
- label suggester
- disagreement detector
- bounded optimization assistant

Do **not** use AI as:

- live decision-maker
- final benchmark truth by itself
- direct auto-merge authority

The deterministic engine remains the thing being measured and improved.

## The Loop

There are two distinct loops:

- **Discovery**
  - uses live reviewer output on imported trajectories
  - finds likely mistakes and candidate promotions
- **Optimization**
  - uses only the frozen promoted calibration corpus
  - scores candidate code changes repeatably

The reviewer is for discovery.

The frozen corpus is for optimization.

### 1. Import

Import public trajectories into local Lab bundles.

Current first source:

- `SWE-bench/SWE-smith-trajectories`

Current landing path:

- `.aperture/lab/bundles/public/...`

The importer should preserve:

- source provenance
- benchmark metadata
- replayable source events
- deterministic timestamps and bundle ids

### 2. Replay

Run the imported bundle through the normal Lab replay path and capture:

- normalized events
- semantic snapshots
- decision snapshots
- traces
- signals
- view snapshots
- final outcomes

The first operational command pair is:

```bash
pnpm lab:fstop:prepare --bundle .aperture/lab/bundles/public/swe-smith/tool/<bundle>.json --json
pnpm lab:fstop:review:run --artifact .aperture/lab/results/offline-review/requests/<bundle>.json --reviewer-command "pnpm lab:fstop:reviewer --provider <provider>" --json
```

The first command prepares a structured review artifact with Aperture's current
read. The second renders the reviewer-model prompt internally, executes the
reviewer command, captures the raw reviewer stdout, writes the completed
artifact, writes the disagreement report, and emits a recommendation summary
plus a run summary that Hermes/OpenClaw can inspect automatically.

The stable adapter command is:

```bash
pnpm lab:fstop:reviewer --provider <provider>
```

It resolves the provider-specific command from environment variables instead of
forcing the main runner to know Hermes/OpenClaw-specific invocation details.
For OpenClaw, the adapter can also call the local `openclaw` binary directly
when it is available on `PATH`, which keeps the unattended VPS contract simpler.
By default it uses a fresh OpenClaw session id per review so batch runs stay
more isolated and repeatable, and it avoids the shared `main` agent session
unless an explicit OpenClaw agent override is set.

### 3. AI Review

Ask an offline reviewer model to evaluate the imported case against a rubric.

The model should review:

- title extraction
- summary extraction
- semantic frame
- tool family
- consequence band
- failure vs waiting vs passive status
- optionally later, active vs queued vs ambient

The output must be structured.

The model should cite the source span or text evidence that supports its read.

### 4. Disagreement Capture

Compare:

- Aperture's semantic read
- Aperture's decision outcome
- AI-reviewed expected interpretation

Produce a disagreement artifact that records:

- source snippet
- Aperture interpretation
- Aperture decision
- AI interpretation
- AI confidence
- disagreement type
- promotion recommendation

The unattended runner should also emit:

- a recommendation summary grouped by likely remediation area
- a run summary with stable artifact paths and counts
- a flat TSV results log for repeated unattended runs
- eventually, a reviewable proposal artifact that bundles:
  - repeated-signal selection
  - candidate calibration promotions
  - optimizer output
  - optional patch diff

### 5. Promotion

Promote only the best disagreements into curated Lab assets.

Promotion targets:

- semantic regression fixtures
- harvested replay scenarios
- held-out validation cases
- future autoresearch train/validation sets

Promotion should remain selective.

The Lab should not turn every imported case into permanent benchmark truth.

The first operational promotion command is:

```bash
pnpm lab:fstop:promote --report .aperture/lab/results/offline-review/disagreements/<bundle>.json --split train --json
```

Promotion freezes:

- corrected expectations from promoted disagreements
- limited same-step invariants to keep nearby classifications stable
- likely target files for remediation

These cases live under:

- `packages/lab/calibration/train`
- `packages/lab/calibration/validation`
- `packages/lab/calibration/heldout`

For unattended VPS operation, the higher-level entrypoint is:

```bash
pnpm lab:fstop:run --provider <provider> --reviewer-provider <provider> --optimizer-provider <provider> --json
```

That agent-managed run should:

- let the provider runtime manage repeated proposal slices
- stop when a proposal with a patch artifact is found
- return one structured run artifact

The underlying proposal loop remains:

```bash
pnpm lab:fstop:propose --reviewer-provider <provider> --optimizer-provider <provider> --json
```

That proposal loop should:

- run discovery in batch
- survive malformed reviewer output on individual bundles
- promote only repeated high-confidence signals
- optimize against the frozen corpus plus those candidate cases
- hand back a proposal artifact for human review

### 6. Improvement

Use promoted disagreements to improve:

- public trajectory mapping
- semantic extraction
- semantic detection/interpreter logic
- discoverability and trace quality

Later, use an `autoresearch`-style loop to search for bounded improvements in:

- importer logic
- semantic-layer logic
- other explicitly approved Lab-only optimization surfaces

The first quiet optimization commands are:

```bash
pnpm lab:fstop:evaluate --json
pnpm lab:fstop:cycle --json
```

`evaluate` reruns the frozen corpus through current core and measures:

- corrected mismatches remaining
- invariant mismatches introduced
- mismatch counts by focus area

`cycle` writes both the evaluation report and a runner-facing optimization brief.

The unattended optimization entrypoint is:

```bash
pnpm lab:fstop:optimize --provider <provider> --json
```

This should run on the VPS from a clean worktree. It regenerates the frozen
calibration report, renders the optimizer prompt, runs the optimizer provider,
checks the edit surface, reruns the calibration report and gates, and writes a
machine-readable optimizer run artifact plus a flat TSV log.

### 7. Gate

Every accepted improvement must still pass deterministic replay gates:

- focused tests
- `pnpm judgment:battle`
- held-out disagreement cases
- full release bar when appropriate

## What To Judge First

Start with the highest-signal and least-subjective dimensions.

### First wave

- title extraction
- issue summary extraction
- semantic intent frame
- tool family
- consequence band
- failure vs waiting vs passive status

### Later

- stronger blocked-work vs question-request distinctions
- approval-like semantics in imported trajectories
- route quality such as `active` vs `queued` vs `ambient`

The later category is more subjective and should come after the semantic layer
is stronger.

## Artifact Shape

The Lab should eventually keep three kinds of external-review artifacts.

### 1. Imported bundle

Raw local replayable public trajectory bundle.

Used for:

- outside pressure
- initial replay
- manual inspection

### 2. Review artifact

Structured AI review of one imported case.

Suggested fields:

- `source`
- `bundlePath`
- `apertureRead`
- `apertureDecision`
- `reviewRead`
- `reviewConfidence`
- `supportingText`
- `disagreementKind`
- `recommendation`

### 3. Recommendation summary

Structured summary of the highest-signal disagreements from one run.

Suggested fields:

- `status`
- `actionableCount`
- `recommendationCounts`
- `items[]`
  - `focusArea`
  - `targets`
  - `owner`
  - `summary`
  - `examples`

### 4. Curated disagreement fixture

A promoted case with explicit assertions that should stay stable in Lab.

Used for:

- regression protection
- held-out validation
- future autoresearch gates

## Human Role

Humans remain the curator.

Humans should:

- define the rubric
- review high-value disagreements
- decide which disagreements are real vs model noise
- promote only the strongest cases

The model can scale review, but it should not replace curation.

## How Autoresearch Fits

`autoresearch` belongs **after** the importer and review loop exist.

The right use is:

- bounded editable surface
- fixed corpus
- fixed held-out gate
- deterministic replay bar
- keep/discard by measured improvement

Good initial optimization surfaces:

- trajectory prompt/title extraction
- bounded semantic detection and interpretation rules
- semantic discoverability output

Bad initial optimization surfaces:

- the whole core engine
- unbounded routing policy
- product shell behavior

## Suggested Cadence

### Per import batch

- import 10-25 trajectories
- replay them
- AI-review them
- inspect the top disagreements

### Weekly

- promote 3-5 useful disagreements into curated fixtures

### Periodically

- run bounded autoresearch against:
  - train corpus
  - validation corpus
  - held-out gate

## Success Metrics

Track improvements in:

- title extraction accuracy
- summary extraction accuracy
- semantic frame agreement
- consequence-band agreement
- false failure rate
- false waiting rate
- number of promoted real-world disagreement cases
- held-out pass rate after semantic changes

## Non-Goals

This loop is not for:

- replacing deterministic core with AI
- adding AI into runtime judgment
- automatically trusting every reviewer-model disagreement
- creating a giant unlabeled corpus with no promotion discipline

## Current Recommendation

Operationalize this in four stages:

1. public trajectory import
2. AI review artifact generation
3. selective disagreement promotion
4. bounded `autoresearch` optimization on top

That keeps the Lab useful immediately while preserving Aperture's core product
truth:

- live path deterministic
- Lab path adaptive
- improvement driven by replay and evidence
