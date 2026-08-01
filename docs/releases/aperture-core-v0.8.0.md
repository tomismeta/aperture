# Aperture Core SDK v0.8.0

`@tomismeta/aperture-core@0.8.0` adds a narrow public evaluator subpath and
hardens the deterministic semantic and judgment engine for messy source event
streams while keeping the root SDK focused on the stateful Core engine.

## Highlights

- adds `@tomismeta/aperture-core/evaluator`
- exposes `evaluateAttention({ claim, context, config, now })`
- returns a versioned `AttentionDecisionRecord`
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
- routes routine observational payloads, readbacks, search/listing output,
  procedural observations, and ambient progress more quietly when structural
  evidence supports that read
- preserves conservative routing for terminal diagnostics, malformed or
  ambiguous structured output, clipped evidence, non-read ownership, and mixed
  diagnostic payloads
- strengthens relation polarity so later resolution, recurrence, regression,
  and supersession clauses govern the deterministic judgment read
- keeps the package export map and runtime dependency surface unchanged
- keeps kernel/replay language internal to architecture and Lab conformance

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
import {
  interpretSourceEvent,
  semanticHintsForTruncatedSourceEvidence,
} from "@tomismeta/aperture-core/semantic";
import { isCandidateTrace } from "@tomismeta/aperture-core/trace";
```

There are no new runtime dependencies and no new root-package parser API.

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

## Validation

Target validation for this release:

```bash
pnpm typecheck
pnpm kernel:corpus
pnpm kernel:conformance
pnpm test
pnpm sdk:prove
pnpm release:check
```

See:

- [Core README](../../packages/core/README.md)
- [Deterministic Attention Kernel](../engine/deterministic-attention-kernel.md)
- [Attention Kernel Lexicon](../engine/attention-kernel-lexicon.md)
