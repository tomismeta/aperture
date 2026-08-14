# Aperture Core SDK v0.9.0

Status: pre-release hardening; not release eligible yet.

`@tomismeta/aperture-core@0.9.0` makes the stateless semantic kernel smaller,
more measurable, and easier to embed. It adds field-level quality gates,
compresses recurring task-failure parsing into one structural grammar, removes
the deprecated parallel ontology vocabulary, and proves deterministic
public-kernel behavior across unrelated host shapes and a 30,000-event scale
workload.

## Highlights

- scores 13 normalized Observation fields, eight observation-judgment fields,
  two decision fields, and exact end-to-end outcomes
- records a 16-fixture calibration freeze, a retired V6 historical experiment,
  and a fresh 32-fixture active release holdout
- requires 100% field and exact-outcome agreement across the active holdout's
  32 expected outcomes
- consolidates task-failure payload parsing into the canonical observation
  grammar instead of maintaining a parallel grammar module
- records the current semantic surface honestly: 105 modules, 165 exported
  detector functions, 255 import edges, and 9,199 total lines
- fixes command-success observations so their semantic result does not depend on
  host title vocabulary when explicit command ownership and summary evidence are
  present
- adds one typed `SourceEvidence` boundary for reliable host-native outcomes,
  diagnostics, payloads, measured partial reads, and authorization requirements
- proves typed evidence and text fallback lower through the same Observation and
  judgment path, with typed facts authoritative over contradictory prose
- keeps reliable truncation hints in the Observation contract: they lower
  evidence strength and record partial evidence loss without promoting a
  bounded source-limit failure into a generic critical failure
- restricts authorization-control parsing to structural pre-execution facts;
  legacy provider-specific rejection scripts are no longer control evidence and
  may surface as indeterminate critical failures; hosts should map
  authorization to typed `SourceEvidence` or emit structural pre-execution facts
- preserves historical scorecard proof metadata and marks proofless historical
  baselines as protected regression comparisons rather than release proof
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

The scorecard covers 16 calibration fixtures and 18 expected outcomes. The
numbered V6 experiment remains useful as historical evidence, but it is not an
active release gate. The active unnumbered holdout is maintainer-authored and
explicitly makes no independent-oracle claim:

- calibration: 234/234 semantic fields, 144/144 judgment fields, 36/36 decision
  fields, and 18/18 exact outcomes
- release holdout: 32/32 exact outcomes, with 12 typed-evidence and 20
  structural-fallback fixtures
- repeated-run determinism: stable for both scorecard and holdout

The release remains a candidate until an independent adversarial review passes
without semantic tuning. The holdout is evidence over bounded structural
families, not statistical accuracy over all possible agent output.

## Semantic Compression

Payload observation parsing now lives in
`task-failure-observation-grammar.ts`. The former payload-specific grammar
module was removed, and the semantic-surface gate understands this only as a
valid consolidation when the old consumer disappears and edge, family, and
detector counts do not grow.

The current generated surface proof records:

- semantic modules: 95
- semantic lines: 8,237
- all semantic-surface modules: 105
- all semantic-surface lines: 9,199
- exported detector functions: 165
- dependency fan-out: 255
- Observation primitive lines: 731
- task-failure parsing lines: 1,084

The budgets fail on renewed module, matcher, phrase-table, or direct-consumer
growth. The protected-base comparison has six exact, digest-bound approvals for
this consolidation tranche; the committed baseline and absolute budgets still
pass. Corpus findings must continue to enter production as structural grammar,
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
`work.updated` events. The event type keeps `status` broad for source
compatibility, while runtime validation rejects evidence on other statuses.
Existing consumers can omit the field and retain the bounded text grammar.
Consumers with reliable native result facts should map those facts in their
adapter instead of manufacturing phrases for Aperture to recognize.
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

Correction-wave focused validation completed on August 13, 2026:

```bash
pnpm release:check
pnpm judgment:bench
```

The focused semantic, judgment, evaluator, and structural-grammar suites pass,
including truncation, authorization, assertion-boundary, and historical-proof
regression coverage. Current verification also passes typecheck, lint, scoped
formatting, dependency audit, contract and schema checks, package boundaries,
architecture budgets, kernel conformance, the honest surface baseline, kernel
corpus, the active holdout, deterministic scale, and judgment battle. Public
SDK and product smoke checks remain environment-sensitive because their package
consumer flows invoke nested package builds. The independent adversarial review
and final publication decision remain outstanding.

This pre-release hardening tranche does not change or publish the Aperture
product package.

See:

- [Core README](../../packages/core/README.md)
- [Deterministic Attention Kernel](../engine/deterministic-attention-kernel.md)
- [Attention Kernel Lexicon](../engine/attention-kernel-lexicon.md)
