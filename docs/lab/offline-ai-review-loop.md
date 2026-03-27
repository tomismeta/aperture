# Offline AI Review Loop

This note defines how Aperture Lab should use AI to improve the semantic and
deterministic path without putting AI in the hot path.

It is a Lab operations note, not a product-surface note.

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

### 1. Import

Import public trajectories into local Lab bundles.

Current first source:

- `SWE-bench/SWE-smith-trajectories`

Current landing path:

- `packages/lab/bundles/public/...`

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

### 5. Promotion

Promote only the best disagreements into curated Lab assets.

Promotion targets:

- semantic regression fixtures
- harvested replay scenarios
- held-out validation cases
- future autoresearch train/validation sets

Promotion should remain selective.

The Lab should not turn every imported case into permanent benchmark truth.

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

### 3. Curated disagreement fixture

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
