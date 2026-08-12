# Aperture Core SDK v0.9.0

Status: release candidate for `@tomismeta/aperture-core@0.9.0`.

`@tomismeta/aperture-core@0.9.0` makes the stateless semantic kernel smaller,
more measurable, and easier to embed. It adds field-level quality gates,
compresses recurring task-failure parsing into one structural grammar, removes
the deprecated parallel ontology vocabulary, and proves deterministic
public-kernel behavior across unrelated host shapes and a 30,000-event scale
workload.

## Highlights

- scores 13 normalized Observation fields, eight observation-judgment fields,
  two decision fields, and exact end-to-end outcomes
- establishes a 16-fixture calibration freeze before an independently authored
  holdout is added
- requires 100% field and exact-outcome agreement across 18 expected outcomes
- consolidates task-failure payload parsing into the canonical observation
  grammar instead of maintaining a parallel grammar module
- reduces the protected semantic surface to 106 modules, 171 exported detector
  functions, 264 import edges, and 9,136 total lines
- fixes command-success observations so their semantic result does not depend on
  host title vocabulary when explicit command ownership and summary evidence are
  present
- adds one typed `SourceEvidence` boundary for reliable host-native outcomes,
  diagnostics, payloads, measured partial reads, and authorization requirements
- proves typed evidence and text fallback lower through the same Observation and
  judgment path, with typed facts authoritative over contradictory prose
- proves two unrelated host event shapes can produce the same public-kernel
  observation, judgment, and reason-code projection
- adds a deterministic mixed-event scale gate with repeated result digests and
  coarse performance characterization
- removes deprecated `SemanticOntology*` names and semantic-era ontology reader
  aliases; `AttentionOntology*` is the only public ontology vocabulary
- keeps the public export map unchanged and adds no runtime, peer, or optional
  dependencies

## Semantic Quality Gate

The Observation Kernel scorecard is now a quality gate rather than a coverage
snapshot. Human-authored expectations are separate from fixture execution and
the report diagnoses drift at three boundaries:

1. normalized Observation semantics
2. deterministic observation judgment
3. end-to-end planner and realized-lane outcome

The implementation-freeze scorecard covers 16 calibration fixtures and 18
expected outcomes:

- calibration: 234/234 semantic fields, 144/144 judgment fields, 36/36 decision
  fields, and 18/18 exact outcomes
- repeated-run determinism: stable

The release remains a candidate until an independent reviewer authors a fresh
post-freeze holdout and the frozen implementation executes it without semantic
tuning. The eventual holdout is evidence over bounded structural families, not
statistical accuracy over all possible agent output.

## Semantic Compression

Payload observation parsing now lives in
`task-failure-observation-grammar.ts`. The former payload-specific grammar
module was removed, and the semantic-surface gate understands this only as a
valid consolidation when the old consumer disappears and edge, family, and
detector counts do not grow.

Compared with the protected 0.8 surface, this tranche records:

- semantic modules: 96
- semantic lines: 8,155
- all semantic-surface modules: 106
- all semantic-surface lines: 9,136
- exported detector functions: 171
- dependency fan-out: 264
- Observation primitive lines: 745
- task-failure parsing lines: 1,058

The budgets fail on renewed module, matcher, phrase-table, or direct-consumer
growth. Corpus findings must continue to enter production as structural grammar,
not provider templates or host names.

## Public Kernel Proof

The public-kernel proof builds and packs the npm tarball, installs it into an
external temporary consumer, and runs a reference embedder. The example maps two
unrelated synthetic host event types into `ApertureKernelEvent` outside core and
asserts an identical semantic projection through the published
`@tomismeta/aperture-core/kernel` subpath.

Both example adapters map different native result shapes into the same
`SourceEvidence` payload. Their prose deliberately disagrees, while the public
kernel returns the same Observation, judgment, and semantic explanation codes.
Hosts cannot provide normalized Observation or judgment fields, and opaque
capability names cannot acquire semantic meaning.

The kernel remains:

- stateless
- host-neutral
- deterministic
- free of runtime dependencies
- separate from runtime hosting, persistence, adapters, and presentation

## API Impact And Migration

`SourceEvidence` is exported from `./kernel` and is optional on failed
`work.updated` events. This is additive, but runtime validation rejects it on
other statuses. Existing consumers can omit the field and retain the bounded
text grammar. Consumers with reliable native result facts should map those facts
in their adapter instead of manufacturing phrases for Aperture to recognize.
The direct-event semantic-default opt-out does not suppress typed evidence;
evidence is an authoritative source contract, not an inferred default.

The typed boundary does not add another evaluation API or semantic path:

`kernel event -> SourceEvent -> observation syntax -> Observation -> judgment`

This release removes deprecated semantic-era ontology aliases. Consumers must
use the canonical names:

| Removed                                  | Use instead                            |
| ---------------------------------------- | -------------------------------------- |
| `SemanticOntologyDiagnostic`             | `AttentionOntologyDiagnostic`          |
| `SemanticOntologyAsk`                    | `AttentionOntologyAsk`                 |
| `SemanticOntologyActivity`               | `AttentionOntologyActivity`            |
| `SemanticOntologyBlocking`               | `AttentionOntologyBlocking`            |
| `SemanticOntologyEpisode`                | `AttentionOntologyEpisode`             |
| `SemanticOntologySource`                 | `AttentionOntologyAuthority`           |
| `readSemanticOntologyDiagnostic(...)`    | `readAttentionOntologyDiagnostic(...)` |
| `projectSemanticOntologyDiagnostic(...)` | `readAttentionOntologyDiagnostic(...)` |

The removed readers were deprecated compatibility wrappers. There is no runtime
fallback or alias. Consumers already using `AttentionOntology*` and
`readAttentionOntologyDiagnostic(...)` require no source change.

Semantic behavior intentionally changes for command-success evidence under a
failed transport status: complete summary evidence can now classify the
observation independently of a host-specific title. Terminal diagnostics retain
their higher-precedence conservative behavior.

The public package subpaths remain:

- `.`
- `./evaluator`
- `./semantic`
- `./kernel`
- `./trace`

## Scale Characterization

`pnpm kernel:scale` evaluates a fixed eight-family workload 30,000 times across
three rounds. Every round must produce the same SHA-256 digest over the complete
canonical public result stream and clear a coarse 1,000 evaluations-per-second
tripwire. Timing and heap movement are reported, but machine-specific timings
are not committed as golden snapshots.

See [Kernel Scale Characterization](../engine/kernel-scale-characterization.md).

## Release Validation

Local validation completed on August 12, 2026:

```bash
pnpm release:check
pnpm judgment:bench
```

`pnpm release:check` includes typecheck, lint, formatting, production dependency
audit, contract and schema validation, package-boundary and architecture checks,
kernel conformance, semantic-surface, corpus, Observation quality, deterministic
scale, the full test suite, judgment battle, packed SDK proof, and product smoke.

The completed run reported:

- 1,284/1,284 tests passing
- 90/90 JudgmentBattle scenarios deterministic
- 2,801/2,801 benchmark assertions passing
- 384/384 fuzz assertions passing
- 30,000 kernel scale evaluations with one repeated SHA-256 result digest
- packed 0.9.0 external-consumer examples passing for the full engine,
  evaluator, kernel, host-neutral embedder, semantic, and trace entrypoints
- packaged Aperture product smoke passing against the workspace core

The standalone JudgmentBench run also passed 2,801/2,801 assertions.

This release candidate does not change or publish the Aperture product package.

See:

- [Core README](../../packages/core/README.md)
- [Deterministic Attention Kernel](../engine/deterministic-attention-kernel.md)
- [Attention Kernel Lexicon](../engine/attention-kernel-lexicon.md)
