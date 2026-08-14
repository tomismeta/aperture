# Observation And Judgment Contract v1

Status: normative release-candidate contract for Aperture Core 0.9.

Contract id: `aperture-observation-judgment-contract/v1`.

## Scope

This contract defines the typed boundary between Aperture's bounded semantic read
and deterministic judgment:

```text
source event -> semantic read -> Observation -> ObservationJudgment
```

There is one implementation path. `ApertureCore`, the internal evaluator, and
`evaluateApertureKernelEvent(...)` consume the same normalized Observation and
the same pure judgment function. The public kernel returns those canonical
artifacts directly, not bounded DTO copies or an alternative parser or judgment
engine.

The contract does not define source adapters, host protocols, persistence,
networking, presentation, or model behavior. Hosts own translation into the
public event contract. Core owns observation and judgment after that boundary.

## Normalized Observation

A normalized Observation is a small semantic document. The Lab scorecard
flattens it into 13 fields; the public kernel nests owner and provenance and uses
`capabilityFamily` for the adapter-facing name of the internal `toolFamily`.

### `kind`

- `control`: a bounded authorization or execution-control state, not execution output
- `diagnostic`: concrete diagnostic evidence about a failed or constrained operation
- `outcome`: a completed result whose outcome is known without treating returned text as payload
- `payload`: returned content, source, search results, or another observational document
- `unknown`: the evidence does not establish a safer semantic kind

### `polarity`

- `success`: explicit successful completion
- `failure`: explicit failed, constrained, or indeterminate failure evidence
- `neutral`: observational payload or control state that is neither a success nor a diagnostic failure
- `unknown`: polarity cannot be established

Transport status and semantic polarity are separate. A failed transport status
does not rewrite an explicit successful outcome or neutral payload.

### `owner` and `toolFamily`

- `tool`: evidence is owned by an explicitly identified capability or tool
- `source`: evidence is source-owned without an identified tool
- `engine`: the engine owns the derived status observation
- `unknown`: ownership cannot be established

`ownership.capabilityFamily` is present only when the normalized event supplies a
bounded capability family. `SourceEvent.toolFamily` is ingress vocabulary and
is mapped once at the source boundary. Fixture prose, context labels, metadata,
and host names do not create capability ownership.

### `subject`

- `command`: command or execution outcome
- `document`: returned document-like payload
- `search`: search outcome or result payload
- `source`: source text or a bounded source view
- `tool`: tool operation or control state
- `unknown`: no narrower subject is supported

Owner answers who supplied the evidence. Subject answers what the evidence is
about. They are independent axes.

### `evidenceLoss`

- `none`: the classified semantic fact is complete for its kind
- `absent`: an expected evidence channel is explicitly empty or missing
- `partial`: evidence exists but a declared boundary omitted part of it
- `unknown`: the engine cannot determine whether relevant evidence is complete

`none` does not mean that every possible diagnostic was present. A complete
outcome-only nonzero result has `none`: the outcome fact is complete even though
no diagnostic payload exists. Explicitly empty failure evidence uses `absent`.
Unbounded or unexplained incompleteness uses `unknown`.

### `evidenceStrength`

- `weak`: abstained, semantically uncertain, low-confidence, absent, or unknown evidence
- `qualified`: supported evidence with a bounded confidence or authority limitation
- `strong`: stable, complete, high-confidence evidence with non-inferred authority

The deterministic derivation is:

1. Return `weak` when semantic interpretation abstained, semantic agreement is
   not `stable`, ontology confidence is `low`, or evidence loss is `absent` or
   `unknown`.
2. At medium ontology confidence, inferred authority is `weak`; explicit or
   hinted authority is `qualified`.
3. At high ontology confidence, inferred authority is `qualified`; explicit or
   hinted authority is `strong`.

### `semanticAgreement`

- `stable`: the Observation agrees with the canonical semantic and ontology read
- `overridden`: an explicit semantic provenance override displaced the canonical read
- `uncertain`: evidence certainty, abstention, confidence, or cross-layer agreement is insufficient

Indeterminate core evidence always normalizes to `uncertain`.

### `diagnosticClass`

- `runtime`: visible runtime, execution, or tool-output diagnostic
- `expected`: a bounded diagnostic result that is itself the expected observation
- `source_limit`: source evidence was returned through a declared partial window
- `null`: the Observation is not diagnostic

### `recoveryHint`

- `await_authorization`: await an authorization decision before execution
- `inspect_diagnostic`: inspect complete diagnostic evidence
- `inspect_original_evidence`: return to ambiguous or indeterminate original evidence
- `narrow_evidence_scope`: request a narrower bounded view of partial evidence
- `request_evidence`: obtain an absent evidence payload
- `null`: no semantic recovery action is implied

### `provenanceOrigin`

- `command_output`: command-owned output grammar
- `read_output`: read-owned payload grammar
- `semantic_evidence`: canonical semantic classification
- `status_text`: bounded status or control grammar
- `structured_output`: validated or recoverable structured output envelope
- `transcript`: explicit observation transcript

### `provenanceAuthority`

- `explicit`, `hinted`, or `inferred`: the canonical ontology authority
- `unknown`: no supported ontology authority

Typed `SourceEvidence` is always explicit. Without typed evidence, a structural
observation that agrees with the explicit failed status is explicit; this
includes failed outcomes, diagnostics, source limits, and indeterminate failed
status. A success, payload, or control that semantically overrides the failed
transport status is inferred from the bounded fallback grammar. An opaque
capability identity affects ownership only and never changes this derivation.

### `consequenceBaseline`

- `low`: passive or bounded status evidence
- `medium`: limited failure or inspectable expected diagnostic
- `high`: visible runtime failure, consequential payload, or indeterminate failure

This is a semantic baseline. Attention policy may route it, but adapters and
presentation layers may not reinterpret it.

## Structural Outcomes

The semantic kernel recognizes structural event families. Exact product or
transcript wording is not part of this contract.

| Structural family                                    | Required normalized shape                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| complete command success                             | `outcome`, `success`, command subject, no evidence loss, low baseline          |
| complete structured execution success                | `outcome`, `success`, structured-output origin, no evidence loss, low baseline |
| complete nonzero outcome without diagnostic channels | `outcome`, `failure`, no evidence loss, medium baseline                        |
| explicitly empty failure evidence                    | `outcome`, `failure`, absent evidence, request-evidence hint, medium baseline  |
| complete runtime diagnostic                          | `diagnostic`, `failure`, runtime class, no evidence loss, high baseline        |
| bounded source window                                | `diagnostic`, `failure`, source-limit class, partial evidence, medium baseline |
| expected diagnostic result                           | `diagnostic`, `failure`, expected class, no evidence loss, medium baseline     |
| returned document, source, or search result          | `payload`, `neutral`, no evidence loss, subject-specific baseline              |
| pre-execution authorization control                  | `control`, `neutral`, await-authorization hint, low baseline                   |
| indeterminate failed evidence                        | `unknown`, `failure`, unknown evidence loss, high baseline                     |

## Authority And Precedence

The semantic read applies these rules before judgment:

1. Concrete terminal diagnostics outrank routine success, payload, and control language.
2. A control is authoritative only when its complete grammar establishes both
   pre-execution non-invocation and absence of an execution result. Contradictory
   terminal evidence prevents control classification.
3. Valid payload boundaries protect diagnostic-looking source or fixture text
   from being promoted to a runtime diagnostic.
4. Explicit capability facts outrank textual family inference. Context, metadata,
   and explanatory labels do not become capability facts.
5. A transport-level failed status does not override a stronger semantic
   outcome or payload observation.
6. `absent`, `partial`, and `unknown` evidence are not aliases and must not be
   collapsed.
7. When evidence does not satisfy a complete structural grammar, the engine
   preserves uncertainty instead of inventing a narrower fact.

## Judgment Projection

`judgeObservation(...)` is pure. The same canonical
Observation always produces the same eight judgment fields.

### Recovery posture

Only these exact semantic shapes produce a non-`none` recovery posture:

| Observation shape                                                   | Recovery posture             |
| ------------------------------------------------------------------- | ---------------------------- |
| neutral control, no loss, await authorization                       | `authorization_required`     |
| failed runtime diagnostic, no loss, inspect diagnostic              | `diagnostic_inspection`      |
| failed expected diagnostic, no loss, inspect diagnostic             | `diagnostic_inspection`      |
| failed unknown observation, unknown loss, inspect original evidence | `original_evidence_required` |
| failed source-limit diagnostic, partial loss, narrow scope          | `evidence_scope_required`    |
| failed outcome, absent loss, request evidence                       | `evidence_required`          |

All other shapes produce `none`.

### Boolean judgments

- `outcomeOnlyFailureStatus` is true only for a stable medium failed outcome
  with `evidenceLoss: none`.
- `limitedFailureStatus` is true for an outcome-only failure, a stable medium
  failed outcome with absent evidence and `evidence_required`, or a stable
  medium failed source-limit diagnostic with partial evidence and
  `evidence_scope_required`.
- `stableStatusEvidence` is true only when semantic agreement is `stable` and
  evidence strength is not `weak`.
- `visibleDiagnosticFailure` is true only for a failed runtime diagnostic with
  no evidence loss.
- `baselineConsequence` copies the Observation consequence baseline unchanged.

### Status evidence

`statusEvidence` uses this precedence:

1. `limited_failure`
2. `visible_diagnostic_failure`
3. `stable_observation`
4. `weak_or_uncertain`

### Status-conflict kind

- an authorization-required tool-owned control about a tool becomes
  `rejected_tool_use_observation`
- structured-output payload becomes `structured_output_observation`
- search-subject payload becomes `search_output_observation`
- other payload becomes `payload_observation`
- successful structured-output outcome becomes `execution_success_observation`
- successful command-subject outcome becomes `command_success_observation`
- other successful outcome becomes `payload_observation`
- all other shapes produce `null`

## Isolated Decision Profile

The holdout decision oracle uses one event per fresh `ApertureCore` instance with
default configuration, no current frame, no prior continuity state, and the
default present operator. This profile measures end-to-end routing without
cross-event state.

| Observation/judgment shape                     | Planner kind | Realized lane |
| ---------------------------------------------- | ------------ | ------------- |
| stable low success, payload, or control status | `ambient`    | `ambient`     |
| limited medium failure                         | `queue`      | `now`         |
| expected medium diagnostic                     | `activate`   | `now`         |
| visible runtime diagnostic                     | `activate`   | `now`         |
| high-consequence payload                       | `activate`   | `now`         |
| high indeterminate failure                     | `activate`   | `now`         |

Planner kind and realized lane are different contracts. In a fresh instance a
queued candidate can realize in `now` because no earlier frame occupies the
surface.

## Independent Holdout Method

Release holdout evidence is valid only when:

1. The implementation and this contract are committed before oracle authorship.
2. The oracle author receives this contract and the artifact schema, but no
   implementation access, execution output, calibration fixtures, or detector
   vocabulary.
3. The complete oracle, including every semantic, judgment, and decision field,
   is committed before first execution.
4. The first run is preserved with a canonical digest and field-level scores.
5. Expected values are never edited after execution.
6. Any implementation tuning informed by a holdout retires that entire holdout
   from release eligibility. A new independent oracle is then required.

Calibration data may explain and improve behavior. It may not be relabeled as
independent holdout evidence.

## Compatibility

Within contract version 1, additive internal extractors and grammar compression
are permitted only when the public field meanings and pure judgment truth table
remain unchanged. Removing, renaming, or reinterpreting a public Observation or
judgment field requires a new contract version.
