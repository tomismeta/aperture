# Aperture Core SDK v0.8.0

Status: release note for `@tomismeta/aperture-core@0.8.0`.

`@tomismeta/aperture-core@0.8.0` adds narrow public evaluator and kernel
subpaths and hardens the deterministic semantic and judgment engine for messy
source event streams while keeping the root SDK focused on the stateful Core
engine.

## Highlights

- adds `@tomismeta/aperture-core/evaluator`
- exposes `evaluateAttention({ claim, context, config, now })`
- returns a versioned `AttentionDecisionRecord`
- adds `@tomismeta/aperture-core/kernel`
- exposes `evaluateApertureKernelEvent(...)` for
  `neutral event -> normalize -> observe -> judge`
- returns `observation`, `observationJudgment`, and versioned explanation reason
  codes without exporting adapter or projection helper APIs
- preserves `claim.timestamp` and records the evaluation clock as `record.evaluatedAt`
- uses `context.current` as the single public current-frame input
- keeps `ApertureCore` as the stateful event, surface, response, and trace loop
- adds bounded semantic source-quality hints through
  `@tomismeta/aperture-core/semantic` for adapter-known truncated evidence
- treats completed source task updates as completion-shaped lifecycle evidence
  without adapter-specific hints
- improves failed-status evidence parsing for outcome-only command exits, empty
  tool payloads, source-window read limits, operation-success observations, and
  read-owned abbreviated source views
- treats failed command outputs that report no matching work, such as no tests
  found or zero collected items, as bounded outcome-only failures when command
  ownership is explicit
- routes routine observational payloads, readbacks, search/listing output,
  procedural observations, and ambient progress more quietly when structural
  evidence supports that read
- preserves conservative routing for terminal diagnostics, malformed or
  ambiguous structured output, clipped evidence, non-read ownership, and mixed
  diagnostic payloads
- strengthens relation polarity so later resolution, recurrence, regression,
  and supersession clauses govern the deterministic judgment read
- compresses the workspace-private task-failure text evidence document from
  legacy boolean fields into a compact shape profile before normalized
  observation judgment
- keeps the root SDK small, adds only explicit advanced subpaths, and keeps the
  runtime dependency surface unchanged
- keeps kernel portability host-neutral with committed adapter conformance
  fixtures and no product-specific core vocabulary

## Semantic And Judgment Hardening

This release makes the semantic layer more shape-aware without adding a model
call, runtime dependency, adapter import, or corpus-specific production branch.

The core now distinguishes several recurring source-event shapes that previously
fell into broad failed-task pressure:

- failed transport statuses whose payload is structurally an observation
- complete nonzero command exits that have outcome-only failure evidence
- read failures caused by bounded source-window limits
- failed updates with no payload evidence
- source-quality cases where an adapter knows the captured evidence was clipped
- completed task updates that carry blocker, ask, or source-activity semantics
- routine progress and duplicate running updates that should stay ambient

The conservative side is still explicit: visible diagnostics, permission
failures, malformed structured envelopes, clipped source evidence, and
unowned or ambiguous payloads continue to stay visible or high consequence.

## Public Surface

The root export remains the stateful engine loop:

```ts
import { ApertureCore } from "@tomismeta/aperture-core";
```

Advanced helpers remain behind explicit subpaths:

```ts
import { evaluateAttention } from "@tomismeta/aperture-core/evaluator";
import { evaluateApertureKernelEvent } from "@tomismeta/aperture-core/kernel";
import {
  interpretSourceEvent,
  semanticHintsForTruncatedSourceEvidence,
} from "@tomismeta/aperture-core/semantic";
import { isCandidateTrace } from "@tomismeta/aperture-core/trace";
```

There are no new runtime dependencies and no new root-package parser API.

## API Impact

The public SDK surface remains stable for this tranche. `SemanticTextEvidence`,
`SemanticTextShape`, `TaskFailureSemanticEvidence`, and
`readTaskFailureSemanticEvidence(...)` are not exported from the root package or
from the public `./semantic`, `./kernel`, `./trace`, or `./evaluator` subpaths.

The workspace-private `@tomismeta/aperture-core/internal` seam is intentionally
not part of the published package export map. Inside the monorepo, its raw
task-failure evidence document now carries a compact `shapes` profile instead
of the previous boolean text-evidence fields. Workspace consumers should prefer
the normalized observation document and the projected observation judgment
contract; code outside `semantic-evidence.ts` should not branch on the raw
text-shape profile directly.

The public `./kernel` subpath is additive. It exposes bounded kernel DTOs and
functions for embedders, but it does not publish `SourceEvent`, raw semantic
evidence, task-failure parser internals, source adapters, sockets, persistence,
or UI behavior.

The complete public export map for this package version is:

- `.`
- `./evaluator`
- `./semantic`
- `./kernel`
- `./trace`

## Evaluator Boundary

The evaluator is pure and stateless. It evaluates one `AttentionClaim` against
explicit context, config, and clock input, then returns the planned judgment.
The public claim and context DTOs are copied into internal candidates and
evidence before judgment, keeping the evaluator subpath decoupled from Core's
runtime state model.

It does not:

- ingest source events
- mutate Core state
- apply human responses
- replay sessions
- persist data
- report a realized lane

Use `ApertureCore` when you need the full `event in -> frame/view out ->
response in` loop.

## Kernel Boundary

The kernel subpath is pure and host-neutral. Hosts either construct an
`ApertureKernelEvent` directly or provide an adapter function from their own
event shape. The result contains:

- finalized neutral event projection
- candidate/clear/noop evaluation
- normalized observation document when one is available
- deterministic observation judgment contract when one is available
- stable explanation reason codes

The committed portability fixture
`packages/core/test/fixtures/kernel-portability-v1.json` proves two unrelated
host event shapes can produce the same observation, judgment, and explanation
without adding host vocabulary to core.

## Validation

Local validation completed on August 3, 2026:

```bash
pnpm release:check
pnpm judgment:bench
```

`pnpm release:check` includes typecheck, lint, format, dependency audit,
contract/schema validation, boundary and architecture checks, kernel
conformance/surface/corpus/observation gates, full tests, judgment battle,
packed SDK proof, and product smoke. The separate JudgmentBench run passed
2,801/2,801 assertions.

See:

- [Core README](../../packages/core/README.md)
- [Deterministic Attention Kernel](../engine/deterministic-attention-kernel.md)
- [Attention Kernel Lexicon](../engine/attention-kernel-lexicon.md)
