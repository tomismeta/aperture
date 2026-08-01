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
- Version decision: not applied by this PR; package versions are inherited from
  the branch base
- Published npm latest at this audit point: `@tomismeta/aperture-core@0.7.0`
- Release tags: no `0.8.0` tag exists locally or on `origin` at this audit point
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
- compact file-created and file-edited observations now use bounded operation
  grammars for safe path-bearing outcomes instead of exact corpus phrases
- read source-window limits now require structural agreement across subject,
  measurement, policy-limit language, and recovery guidance instead of matching
  one upstream diagnostic envelope
- `task.updated` events whose status is `completed` now receive completion
  semantics without adapter-specific hints, while explicit source activity,
  operator-directed asks, waiting text, and blocker text preserve their narrower
  status-shaped semantics
- common ambient progress traffic is now locked in the kernel corpus: task
  starts, running read/bash/edit progress, waiting read progress, stale duplicate
  running updates, and failed read observations stay ambient or suppressed unless
  general evidence makes them actionable

This is a behavioral improvement, not just Lab tooling. Core production code now
has more explicit machinery for source-quality facts, observational status
conflicts, outcome-only failures, owned observation payloads, and relation
polarity, and completed-update lifecycle reads. The ambient-progress work is a
kernel contract hardening: it proves the existing semantic and judgment axes are
expressive enough for those real corpus shapes without adding adapter-specific
runtime branches.

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
- `pnpm boundary:check` also rejects production core imports from sibling
  package implementations and rejects core test imports from adapter
  implementation files or adapter workspace packages; relative implementation
  imports are resolved and normalized before classification so alternate `../`
  and `./` spellings cannot bypass the gate
- cross-adapter semantic parity coverage now lives in the product integration
  test layer instead of core
- public-corpus importers and calibration logic remain in `packages/lab`
- Lab consumes source-quality support through public or bounded core seams
- `pnpm kernel:corpus` verifies both the full corpus conformance report and a
  compact scorecard for scenario count, dimension coverage, semantic ontology
  checkpoints, decision projection checkpoints, relation checkpoints,
  decision-fingerprint uniqueness, and semantic/judgment outcome coverage as a
  reported snapshot
- the scorecard carries per-scenario semantic ontology, relation, and decision
  projection checkpoint digests plus actual outcome distributions for semantic
  intents, activities, consequences, ontology sources, judgment routes, lanes,
  confidence, and failure details; `pnpm kernel:corpus` compares the generated
  scorecard against the committed baseline so aggregate totals cannot hide a
  lost scenario-specific semantic or judgment assertion or a lost covered
  outcome shape
- `pnpm kernel:corpus:write` refuses to overwrite the scorecard without a valid
  baseline comparison unless an intentional scorecard rebaseline flag is used
- `pnpm kernel:corpus` compares against the protected base scorecard when it is
  available in git history; for this PR shape, where `main` does not yet contain
  the v3 artifact, it falls back to the previous committed branch scorecard and
  also fails on threshold regressions, so the branch cannot pass only by updating
  its own scorecard baseline
- classifier growth is now guarded by module budgets for:
  - `packages/core/src/semantic-detection.ts`
  - `packages/core/src/semantic-evidence.ts`
  - `packages/core/src/semantic-owned-observation-payload-shapes.ts`
- recursive semantic-module discovery currently accounts for 100 core semantic
  modules and 8,567 lines; each discovered module has an explicit line budget,
  and the architecture gate also enforces aggregate semantic-module count and
  total-line budgets
- the packed SDK example compiles the new semantic helper import through
  `@tomismeta/aperture-core/semantic`
- the public SDK manifest test asserts `@tomismeta/aperture-core` has no
  runtime `dependencies`, `peerDependencies`, or `optionalDependencies`
- the product package smoke test installs the packed `@tomismeta/aperture`
  tarball, starts the packaged `aperture internal runtime` on a random local
  port, publishes a lexically distinct bounded read source-window failure
  through `/runtime/events/source`, and verifies the emitted runtime session
  trace uses the current core semantic judgment and softened failure routing
  (`failure` / `tool_failure` / `read` / `source_window_limit` / `medium` /
  queued)

The implementation should continue to prefer event-shape predicates over
dataset-specific branches. If a future corpus finding cannot be explained as a
general event shape, it belongs in Lab review data until the shape is clearer.

## Publish Recommendation

Do not publish directly from this PR without a version and release-note pass.

Recommended version posture:

- prefer the next minor after the currently versioned core package for
  `@tomismeta/aperture-core`, because the API change is additive but the
  semantic and judgment behavior changes are meaningful
- do not cut `@tomismeta/aperture` unless the product package should ship the
  embedded core behavior at the same time
- if cutting `@tomismeta/aperture`, describe it as embedded core judgment
  hardening with no new CLI command surface

Before publish:

1. choose the target version
2. update `packages/core/package.json`
3. replace or supersede the existing unreleased
   `docs/releases/aperture-core-v0.8.0.md` note if `0.8.0` remains the chosen
   target version, or add a new versioned
   `docs/releases/aperture-core-vX.Y.Z.md`
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

- local `pnpm release:check`: passing on August 1, 2026 UTC, which was July 31,
  2026 in the local America/Denver run context, after the Sol remediation pass
- full local test suite: 1,199 passing; focused local suites on the
  completed-update tranche add 222/222 passing semantic, normalization,
  ontology, and evaluator checks
- focused semantic/kernel/lab suites for the explicit read abbreviated-file-view
  tranche add 96/96 passing checks
- Sol follow-up generalized the abbreviated-file-view recognizer away from
  exact provider command wording; the production predicate now requires
  oversized-source, partial-view, range-recovery, and source-payload structure,
  with lexical variants covered in focused semantic tests
- focused public SDK surface suite after product-surface audit:
  `packages/core/test/public-sdk.test.ts` passed 11/11
- packed SDK proof after product-surface audit: tarball shape plus full engine,
  evaluator, semantic, and trace entrypoint examples passed
- packed product smoke after product-surface audit: install, help, hook setup,
  packaged runtime semantic/judgment/routing probe, uninstall cleanup,
  dependency-free manifest, and no library `main` passed
- judgment battle determinism: 89/89 stable
- judgment benchmark: 2,765 passing
- judgment fuzz: 384 passing
- kernel corpus scorecard v3: 49 scenarios, 16 covered dimensions, 2,014
  passing corpus assertions, 58 ontology checkpoints, 69 decision projection
  checkpoints, 13 relation checkpoints, 49 per-scenario checkpoint ledgers, 23
  unique decision fingerprints, and semantic/judgment outcome coverage for
  intent frames, activity classes, ontology sources, routes, lanes, confidence,
  consequences, and failure details
- local harvested-session review-candidates replay scans 499 local session
  bundles directly; current-engine replay produced 4,176 comparable steps, 514
  failed updates, 0 invalid inputs, 0 semantic abstentions, 0 missing semantic
  snapshots, 0 missing judgment snapshots, 0 unclassified failures, 0 missing
  tool families, 8 failed read observations, 506 terminal failures, 6
  outcome-only failures, 0 novel structural observations, and 0 novel failure
  observations versus the kernel corpus baseline
- source-quality audit note: the replay's `clipped_summary: 4` evidence-loss
  count is four replay observations, not four independent parser misses; the
  retained examples reduce to two unique bash loader failures duplicated across
  two imports, and each currently routes as `terminal_failure` / `diagnostic` /
  high consequence / activate-now with no routing ambiguity. Treat clipped
  evidence as a monitoring signal unless it produces `unclassified_failure`,
  `indeterminate`, softened consequence, parser-gap signatures, or routing
  ambiguity.
- new kernel corpus dimensions: `source_quality_gap` and
  `completed_update_semantics`
- latest kernel corpus dimension: `ambient_progress_shapes`
- new golden scenarios:
  `golden:kernel-corpus:empty-failure-payload-stays-visible-with-weak-evidence`,
  `golden:kernel-corpus:read-source-window-limit-stays-visible`,
  `golden:kernel-corpus:read-abbreviated-file-view-stays-ambient`,
  `golden:kernel-corpus:read-owned-markdown-manual-stays-ambient`,
  `golden:kernel-corpus:read-owned-midfile-source-preserves-high`,
  `golden:kernel-corpus:bash-compiler-source-diagnostic-stays-terminal`,
  `golden:kernel-corpus:bash-loader-path-heavy-diagnostic-stays-terminal`, and
  `golden:kernel-corpus:bash-loader-plain-diagnostic-stays-terminal`
- completed-update golden scenarios:
  `golden:kernel-corpus:completed-update-blocker-stays-status-shaped`,
  `golden:kernel-corpus:completed-update-implied-ask-stays-status-shaped`, and
  `golden:kernel-corpus:completed-update-session-activity-preserves-source`
- ambient-progress golden scenarios:
  `golden:kernel-corpus:duplicate-running-progress-suppresses-stale-repeat`,
  `golden:kernel-corpus:failed-read-observation-stays-medium-ambient`,
  `golden:kernel-corpus:operational-progress-stays-medium-ambient`, and
  `golden:kernel-corpus:read-lifecycle-progress-stays-ambient`
- focused review found relation-ordering, truncation-helper, and public-surface
  documentation issues; this branch now includes fixes and regression coverage
- Sol review found the original merge-blocking risks plus follow-up gate gaps:
  exact corpus-derived phrase matching, self-baselined corpus scorecards, weak
  dependency-direction boundaries, semantic-module budget loopholes, and lost
  cross-adapter parity coverage. This branch now remediates those by
  generalizing the predicates, comparing scorecards against protected base or
  branch history, failing threshold regressions, relocating cross-adapter parity
  to a product integration test, tightening package-boundary checks, and adding
  explicit plus aggregate recursive semantic-module budgets.

## Remaining Work

Before merge:

- keep PR #51 draft until human review is comfortable
- review this note against the final PR body
- rerun GitHub checks after the latest local corpus tranche is pushed
- avoid adding unrelated features to the release-readiness pass

After merge, before npm:

- choose version
- write the actual versioned release note
- decide whether the product package should be cut with the core behavior
- rerun the full release gate from `main`
