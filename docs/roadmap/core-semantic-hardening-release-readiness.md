# Core Semantic Hardening Release Readiness

Status: draft release-readiness note for PR #51, written on July 31, 2026.

This note captures what should be true before publishing the corpus-driven core
semantic and judgment hardening tranche. It is intentionally version-neutral:
no npm cut has been chosen yet, and existing npm consumers remain unaffected
until a new package is published.

## Current Branch

- PR: [#51 Harden corpus-driven semantic judgment](https://github.com/tomismeta/aperture/pull/51)
- Branch: `codex/corpus-gap-core-hardening`
- Package versions on branch:
  - `@tomismeta/aperture-core@0.8.0`
  - `@tomismeta/aperture@0.4.2`
- Version decision: not applied
- Runtime dependencies: unchanged
- Published package manifests: no version, export-map, files-list, or runtime
  dependency changes
- Root workspace manifest: updated only to include the new package-boundary test
  in normal test and format gates
- Lockfile: unchanged

## What This Tranche Changes

The tranche makes the core semantic and judgment engine more conservative and
more shape-aware over messy event streams.

The main behavior changes are:

- failed task updates with routine observational evidence can stay lower impact
  instead of always becoming critical failed work
- complete outcome-only nonzero command exits are treated as medium failed
  statuses instead of diagnostic high-severity failures
- truncated failed evidence remains conservative, so clipped source output does
  not accidentally soften a failure
- semantic hints and metadata cannot forge low-impact status-conflict routing
  without raw evidence agreement
- relation cues are ordered, so later asserted or negated resolution,
  recurrence, and escalation language governs the final deterministic read
- procedural, readback, listing, command-output, source-window, and transcript
  shapes are parsed as event shapes rather than corpus-specific exceptions

This is a behavioral improvement, not just Lab tooling. Core production code now
has more explicit machinery for source-quality facts, observational status
conflicts, outcome-only failures, owned observation payloads, and relation
polarity.

## Public Package Surface

The root SDK surface remains focused on the stateful engine loop:

`ApertureCore -> publish/publishSourceEvent -> AttentionFrame/AttentionView -> submit`

The existing package export map is unchanged:

- `.`
- `./evaluator`
- `./semantic`
- `./trace`

The only additive public runtime helper is on the existing `./semantic` subpath:

- `semanticHintsForTruncatedSourceEvidence(...)`
- `TRUNCATED_SOURCE_EVIDENCE_FACTOR`
- `TruncatedSourceEvidenceHintOptions`

These are adapter-facing helpers for source-quality facts that the adapter knows
before Aperture sees the full payload, such as clipped stderr, paginated logs, or
a transcript window that omitted earlier evidence.

They should not be described as a parser, classifier, recovery mechanism, or
general failure-severity override. The helper only supplies bounded semantic
hints: low confidence, a source-quality factor, and high consequence by default
for failed truncated evidence. It cannot lower failed evidence to medium or low
consequence.

The evaluator subpath also has an additive optional type field:

- `AttentionClaimJudgment.outcomeOnlyFailureStatus`

This is a replay and explanation marker for complete nonzero command exits that
have outcome-only failure evidence. It does not add a new evaluator runtime
function.

## Existing User Impact

API compatibility risk is low:

- no published package version changes
- no published package export-map changes
- no published package runtime dependency changes
- no lockfile changes
- no new runtime dependencies
- no removed entrypoints
- no export map changes
- root, evaluator, and trace runtime entrypoints are unchanged
- evaluator consumers who exhaustively model `AttentionClaimJudgment` may see
  the new optional `outcomeOnlyFailureStatus` field
- semantic/evaluator consumers who exhaustively model task failure details may
  see the new `absent_evidence` detail for payloadless failed tool updates and
  `source_window_limit` for bounded read window-limit failures
- Lab semantic review candidate reports move from schema version 13 to 14
  because `failureDetailCounts` now includes `source_window_limit`
- `SourceEvent` remains the same structural DTO; only metadata guidance changed

Behavioral compatibility risk is real but intentional:

- users who snapshot exact lanes, tones, or consequences for failed
  `task.updated` source events may see changed outputs for messy event shapes
- events with routine successful command output under a failed transport status
  may route more quietly
- complete nonzero command exits with no diagnostic payload may route as medium
  outcome-only failures
- explicit tool-family failed updates whose payload is only `{}` now stay
  visible as medium-consequence limited failure evidence instead of routing as
  critical by default; higher-risk wording or terminal diagnostics still
  escalates them
- read failures caused only by concrete source-window limits now stay visible as
  medium-consequence limited failure evidence; mixed strong diagnostics such as
  permission failures remain high-consequence diagnostics
- truncated failures should remain conservative rather than being softened by
  incomplete source evidence
- relation wording such as resolved, regressed, returned, not fixed, or no
  regression now follows deterministic latest-clause polarity
- supersession inference no longer treats every bare `instead` token as a
  relation; it still reads bounded imperative replacement wording such as
  "use/follow/switch/adopt ... instead" while excluding `instead of ...`

Release notes should call this out as a semantic/judgment behavior hardening
release, not as a cosmetic or docs-only release.

## Boundary And Coupling Review

The intended boundary remains:

**Adapters provide facts. Core provides judgment.**

Current review evidence:

- corpus-specific source names are absent from `packages/core/src`
- `pnpm boundary:check` now guards `packages/core/src` against known
  corpus-specific labels
- public-corpus importers and calibration logic remain in `packages/lab`
- Lab consumes source-quality support through public or bounded core seams
- `pnpm kernel:corpus` verifies both the full corpus conformance report and a
  compact scorecard for scenario count, dimension coverage, semantic ontology
  checkpoints, decision projection checkpoints, relation checkpoints, and
  decision-fingerprint uniqueness as a reported snapshot
- the scorecard carries per-scenario semantic ontology, relation, and decision
  projection checkpoint digests; `pnpm kernel:corpus` compares the generated
  scorecard against the committed baseline so aggregate totals cannot hide a
  lost scenario-specific semantic or judgment assertion
- `pnpm kernel:corpus:write` refuses to overwrite the scorecard without a valid
  baseline comparison unless an intentional scorecard rebaseline flag is used
- classifier growth is now guarded by module budgets for:
  - `packages/core/src/semantic-detection.ts`
  - `packages/core/src/semantic-evidence.ts`
  - `packages/core/src/semantic-owned-observation-payload-shapes.ts`
- the packed SDK example compiles the new semantic helper import through
  `@tomismeta/aperture-core/semantic`
- the public SDK manifest test asserts `@tomismeta/aperture-core` has no
  runtime `dependencies`, `peerDependencies`, or `optionalDependencies`

The implementation should continue to prefer event-shape predicates over
dataset-specific branches. If a future corpus finding cannot be explained as a
general event shape, it belongs in Lab review data until the shape is clearer.

## Publish Recommendation

Do not publish directly from this PR without a version and release-note pass.

Recommended version posture:

- prefer the next minor for `@tomismeta/aperture-core`, because the API change is
  additive but the semantic and judgment behavior changes are meaningful
- do not cut `@tomismeta/aperture` unless the product package should ship the
  embedded core behavior at the same time
- if cutting `@tomismeta/aperture`, describe it as embedded core judgment
  hardening with no new CLI command surface

Before publish:

1. choose the target version
2. update `packages/core/package.json`
3. add a versioned `docs/releases/aperture-core-vX.Y.Z.md`
4. update any npm-facing README links that should point at the new release
5. run `pnpm release:check`
6. run `pnpm sdk:prove`
7. verify GitHub checks are green
8. only then publish

## Validation Evidence

Current branch validation:

```bash
pnpm release:check
pnpm sdk:prove
pnpm typecheck
pnpm format:check
pnpm architecture:check
pnpm boundary:check
pnpm exec tsx --test packages/core/test/public-sdk.test.ts
pnpm exec tsx --test packages/core/test/semantic-detection.test.ts packages/core/test/semantic-normalization.test.ts packages/core/test/semantic-evidence.test.ts packages/core/test/event-evaluator.test.ts packages/core/test/judgment-input.test.ts packages/core/test/judgment-coordinator.test.ts
```

Additional branch evidence:

- local `pnpm release:check`: passing
- full local test suite: 1,178 passing
- judgment battle determinism: 78 passing
- judgment benchmark: 2,325 passing
- judgment fuzz: 384 passing
- kernel corpus scorecard: 38 scenarios, 14 covered dimensions, 1,574 passing
  corpus assertions, 42 ontology checkpoints, 52 decision projection
  checkpoints, 13 relation checkpoints, 38 per-scenario checkpoint ledgers, 22
  unique decision fingerprints
- local harvested-session review-candidates replay now scans canonical F-Stop
  session directories directly; current-engine replay over 484 local sessions
  produced 4,071 comparable steps, 499 failed updates, 0 invalid inputs, 0
  unclassified failures, 8 failed read observations, 491 terminal failures, 6
  outcome-only failures, and, after promoting the repeated medium read/manual and
  high-consequence mid-file read/source observation shapes, 6 novel failure
  observations versus the kernel corpus baseline
- new kernel corpus dimension: `source_quality_gap`
- new golden scenarios:
  `golden:kernel-corpus:empty-failure-payload-stays-visible-with-weak-evidence`,
  `golden:kernel-corpus:read-source-window-limit-stays-visible`,
  `golden:kernel-corpus:read-owned-markdown-manual-stays-ambient`, and
  `golden:kernel-corpus:read-owned-midfile-source-preserves-high`
- PR #51 GitHub checks should be rerun after pushing this tranche
- focused review found relation-ordering, truncation-helper, and public-surface
  documentation issues; this branch now includes fixes and regression coverage

## Remaining Work

Before merge:

- keep PR #51 draft until human review is comfortable
- review this note against the final PR body
- avoid adding unrelated features to the release-readiness pass

After merge, before npm:

- choose version
- write the actual versioned release note
- decide whether the product package should be cut with the core behavior
- rerun the full release gate from `main`
