# Aperture Core SDK v0.4.0

`@tomismeta/aperture-core@0.4.0` should be a trust and hardening release.

It should not just mean "more features landed."
It should mean the SDK is harder to misuse, the replay/runtime seams are more
defensible, and the external embedding story is clearer.

## Release Intent

If we cut `0.4.0`, it should stand for:

- a stable, intentional root SDK surface
- deterministic source-event ingestion without obvious replay footguns
- validated session/scenario tooling instead of bare-cast artifact loading
- a cleaner external embed story for hosts like Paperclip

If those are not true, stay on `0.3.x`.

## Preflight Decision

Before doing any other release work, decide the version story clearly.

- [ ] decide whether `0.3.0` was an internal branch-state version or a real public release target
- [ ] if `0.3.0` is meant to be public, reconcile package version, npm state, and git tags first
- [ ] if `0.4.0` is the next real public release, say that explicitly in the release note and publish flow

Current repo state to reconcile:

- [packages/core/package.json](../../packages/core/package.json) is now `0.4.0`
- git tags currently stop at `aperture-core-v0.2.2`

## Must Do

These are release blockers.

### 1. Tighten replay and artifact validation

- [ ] validate golden/harvested scenarios on load instead of bare-casting parsed JSON
- [ ] strengthen session-bundle validation beyond top-level field presence
- [ ] make promotion scripts use validation rather than direct `JSON.parse(... ) as ...`
- [ ] add tests for malformed array contents in session bundles and replay scenarios

Primary file areas:

- [packages/lab/src/golden.ts](../../packages/lab/src/golden.ts)
- [packages/lab/src/session-bundle.ts](../../packages/lab/src/session-bundle.ts)
- [scripts/session-promote.ts](../../scripts/session-promote.ts)
- [packages/lab/test/session-bundle.test.ts](../../packages/lab/test/session-bundle.test.ts)

### 2. Tighten runtime-side external payload handling

- [ ] reduce bare-cast handling of external JSON in runtime request handlers
- [ ] make source-event payload normalization validate shape more explicitly
- [ ] ensure failures are clear and operator-visible rather than silently trusted

Primary file areas:

- [packages/runtime/src/runtime.ts](../../packages/runtime/src/runtime.ts)
- [packages/runtime/src/runtime-client.ts](../../packages/runtime/src/runtime-client.ts)

### 3. Close the response-capture gap

- [ ] ensure submitted responses are not lost from session capture when `core.submit(...)` throws
- [ ] decide whether failed submit attempts should be recorded explicitly or reordered conservatively

Primary file area:

- [packages/runtime/src/runtime.ts](../../packages/runtime/src/runtime.ts)

### 4. Remove deterministic-path footguns

- [ ] remove the wall-clock default from attention-evidence context resolution
- [ ] replace duplicated actionable-episode thresholds with one shared source of truth
- [ ] review replay and trace helpers for other implicit wall-clock or duplicated-default behavior

Primary file areas:

- [packages/core/src/attention-evidence.ts](../../packages/core/src/attention-evidence.ts)
- [packages/core/src/trace-evaluator.ts](../../packages/core/src/trace-evaluator.ts)
- [packages/core/src/judgment-defaults.ts](../../packages/core/src/judgment-defaults.ts)

### 5. Scrub harvested fixture leakage

- [ ] remove or redact machine-local absolute paths from harvested lab artifacts
- [ ] make sure future promotion/export paths do not keep leaking local filesystem details into checked-in fixtures

Primary file areas:

- [packages/lab/harvested](../../packages/lab/harvested)
- [packages/lab/src/golden.ts](../../packages/lab/src/golden.ts)
- [scripts/session-export.ts](../../scripts/session-export.ts)
- [scripts/session-promote.ts](../../scripts/session-promote.ts)

### 6. Re-run the real release bar

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm judgment:bench`
- [ ] `pnpm judgment:fuzz`
- [ ] `pnpm sdk:prove`

### 7. Tighten the shipped dist surface

- [ ] make the packed tarball contain only the supported entrypoints:
  - `dist/index.*`
  - `dist/semantic.*`
- [ ] avoid shipping the full internal module graph under `dist/`
- [ ] confirm the tarball contents match the public `exports` story

Reference:

- [Package Splitting Decision](../roadmap/package-splitting-decision.md)

## Should Do

These are not blockers individually, but together they make `0.4.0` much more believable.

### 1. Add CLI coverage for session tooling

- [ ] add tests for `session-export`
- [ ] add tests for `session-record`
- [ ] add tests for `session-promote`
- [ ] cover arg parsing, runtime discovery fallback, unhappy-path behavior, and malformed input handling

Primary file areas:

- [scripts/session-export.ts](../../scripts/session-export.ts)
- [scripts/session-record.ts](../../scripts/session-record.ts)
- [scripts/session-promote.ts](../../scripts/session-promote.ts)

### 2. Reduce lab-to-core internal coupling

- [ ] review deep relative imports from lab into core internals
- [ ] either accept them as intentional friend-surface usage or narrow them behind clearer exports
- [ ] make sure the SDK story stays honest: public consumers use the package surface, repo-internal lab code uses intentional internal seams

Primary file areas:

- [packages/lab/src/scenario.ts](../../packages/lab/src/scenario.ts)
- [packages/lab/src/scorecard.ts](../../packages/lab/src/scorecard.ts)

### 3. Clean up benchmark/report brittleness

- [ ] review JudgmentBench summary assumptions and expectation handling
- [ ] make sure trace/report generation behaves well when expectations are absent or partial

Primary file areas:

- [packages/lab/src/judgment-bench.ts](../../packages/lab/src/judgment-bench.ts)
- [packages/lab/src/report.ts](../../packages/lab/src/report.ts)

### 4. Re-verify a real external consumer

- [ ] pack the SDK tarball locally
- [ ] install it into a clean temp project
- [ ] verify at least one real external consumer compiles against the packed SDK
- [ ] confirm the Paperclip integration still works against the tarball, not just the workspace

Recommended proof consumer:

- [`paperclip-aperture`](https://github.com/tomismeta/paperclip-aperture)

### 5. Refresh release-facing docs

- [ ] update npm-facing README language if needed
- [ ] make sure the SDK path doc matches the actual release posture
- [ ] write the final highlights/why-this-matters text once the diff is stable

Primary file areas:

- [README.md](../../README.md)
- [docs/product/sdk-path.md](../product/sdk-path.md)
- [docs/product/adapter-contract.md](../product/adapter-contract.md)
- [packages/core/README.md](../../packages/core/README.md)

## Nice To Have

These improve polish, but should not hold the release by themselves.

### 1. Batch small cleanup items

- [ ] remove trivial wrappers and dead returns
- [ ] tighten small untested utility edges
- [ ] clean cosmetic inconsistencies that keep surviving review

Examples:

- [packages/core/src/aperture-core.ts](../../packages/core/src/aperture-core.ts)
- [packages/core/src/attention-planner.ts](../../packages/core/src/attention-planner.ts)
- [packages/core/test/semantic-uncertainty-criterion-rule.test.ts](../../packages/core/test/semantic-uncertainty-criterion-rule.test.ts)

### 2. Reduce script duplication

- [ ] consolidate shared CLI helpers across session scripts if it can be done cleanly
- [ ] prefer one small shared helper over three near-duplicate implementations

Primary file areas:

- [scripts/session-export.ts](../../scripts/session-export.ts)
- [scripts/session-record.ts](../../scripts/session-record.ts)
- [scripts/session-promote.ts](../../scripts/session-promote.ts)

### 3. Make default directories a little less brittle

- [ ] review `process.cwd()`-at-import-time defaults in lab tooling
- [ ] move to resolved-at-call-time defaults if that improves library behavior without complicating the code

Primary file areas:

- [packages/lab/src/golden.ts](../../packages/lab/src/golden.ts)
- [packages/lab/src/session-bundle.ts](../../packages/lab/src/session-bundle.ts)

## Publish Checklist

Once the release bar is met:

- [ ] update [packages/core/package.json](../../packages/core/package.json) to `0.4.0`
- [ ] rebuild and pack:

```bash
pnpm --filter @tomismeta/aperture-core build
cd packages/core
pnpm pack
```

- [ ] inspect the tarball contents and confirm the export surface matches release intent
- [ ] publish:

```bash
cd packages/core
npm publish --access public
```

- [ ] create and push the matching git tag
- [ ] create the GitHub release entry

## Post-Publish Checks

- [ ] verify npm shows `0.4.0`
- [ ] install the published package into a clean temp project and compile the minimal SDK loop
- [ ] verify the external-consumer proof path still works against the published package
- [ ] update any repo-level docs or release references that still point at older versions

## Bottom Line

`0.4.0` should be the release where the SDK story becomes harder to question.

The most important bar is not "did we add more?"
It is:

- can we trust the ingestion path?
- can we trust the deterministic path?
- can we trust the published SDK contract?

If yes, cut `0.4.0`.
If not, keep hardening on `0.3.x`.
