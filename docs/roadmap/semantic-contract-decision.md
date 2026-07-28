# Semantic Contract Decision

This note makes the current semantic contract explicit for `@tomismeta/aperture-core`.

It exists to answer two questions clearly:

1. which semantic fields are live judgment inputs today?
2. what is the contract for `task.updated` semantics vs status routing?

## Why This Decision Exists

`SemanticInterpretation` grew faster than the rest of the engine contract.

That is not a failure. It is a normal stage in a young semantic layer.

But it does create risk:

- some fields look more authoritative than they really are
- some fields are valuable for explanation or benchmarking, but not routing
- `task.updated` semantics can look richer than the evaluator currently permits

This note removes that ambiguity.

## Main Decision

The semantic layer is allowed to be richer than the routing layer, but it must be explicit about which fields are:

- decision-bearing now
- explanation-bearing now
- confidence or abstention signals for future policy work
- diagnostic or benchmark-facing semantics that should not silently change routing

## Field Taxonomy

### 1. Decision-bearing now

These fields are allowed to affect canonical events or downstream judgment today.

- `toolFamily`
  - can be projected into canonical events when the source does not supply it
  - can affect consequence interpretation for human-input requests
- `activityClass`
  - can be projected into canonical events when the source does not supply it
- `consequence`
  - decision-bearing on the `human.input.requested` path
  - not authoritative for `task.updated`
- `relationHints`
  - continuity-bearing
  - allowed to affect episode evidence and continuity handling

### 2. Explanation-bearing now

These fields are valuable and should be preserved, but they are not direct routing inputs on their own.

- `intentFrame`
- `whyNow`
- `factors`
- `reasons`

These exist to make Aperture's semantic read inspectable, benchmarkable, and easier to explain.

## 3. Confidence and abstention signals

These fields are part of the semantic contract. They are not hidden score multipliers, but they now have one bounded live use in the engine.

- `confidence`
- `abstained`

Near-term intent:

- support bounded ambiguity handling
- support future abstention-aware routing or peripheral handling
- make semantic uncertainty visible in Lab and debugging

Current rule:

- do not treat `confidence` as a hidden scoring multiplier
- low-confidence or abstained non-blocking work may resolve to `queue` or `ambient` through the explicit ambiguity lane
- do not let `confidence` or `abstained` silently override explicit status routing or blocking human-input handling

The current influence matrix is locked in tests under:

- `packages/core/test/semantic-contract.test.ts`
- `packages/core/test/semantic-normalization.test.ts`
- `packages/core/test/judgment-coordinator.test.ts`

### 4. Removed ambiguous fields

These fields were removed from the core semantic shape in this tranche:

- `operatorActionRequired`
- `requestExplicitness`

Why:

- they were not authoritative routing inputs
- they were not needed to preserve current explanation behavior
- they encouraged readers to assume the engine honored semantics it did not actually route on

The retained substitutes are:

- `whyNow`
- `reasons`
- `confidence`

Those fields preserve useful semantic signal without pretending there is already a fully live operator-action or explicitness contract in the hot path.

## `task.updated` Contract

This is the most important current decision.

### Decision

For `task.updated`, status remains authoritative for routing.

That means:

- `status` decides status candidate tone
- `status` decides status candidate priority
- `status` decides status candidate response spec
- `status` decides status candidate consequence

The semantic layer is still useful on this path, but in a bounded way.

The one current exception is explicit and compiled before judgment:

- a `failed` status with high-confidence, low-consequence, engine-owned routine
  bash success evidence can become a routine observational status conflict
- that conflict may lower status routing to non-interruptive status handling
- core does not mutate the original `status`; trace records the semantic routing
  exception
- adapter-supplied semantic hints may veto the exception through confidence,
  abstention, or the final semantic shape, but they cannot manufacture the
  underlying raw evidence

### What semantic interpretation is allowed to do on `task.updated`

- infer `toolFamily` if the source omitted it
- infer `activityClass` if the source omitted it
- infer `relationHints` for continuity
- compile routine observational status conflicts for judgment
- provide `whyNow`, `factors`, and `reasons` for provenance and explanation
- provide inspection metadata like `intentFrame`, `confidence`, and `abstained`

### What semantic interpretation is not allowed to do on `task.updated`

- silently override status-derived consequence
- silently turn a passive status into a blocking human-input event
- silently change response-spec shape from status handling into approval/choice/form handling
- demote failed status from generic success wording, low-confidence semantics, or
  payloads that also contain terminal failure evidence
- demote failed status because adapter-provided `factors` or `reasons` claim an
  observational payload without matching engine-owned evidence

If Aperture later wants implied asks in status updates to change routing, that must become a deliberate policy decision, not an accidental side effect of richer semantics.

## Product And Release Impact - 2026-07-27

The semantic-evidence tranche changes runtime behavior only on narrow
`task.updated` failed-status reads. It does not add a public SDK export and does
not add a runtime dependency to `@tomismeta/aperture-core` or
`@tomismeta/aperture`.

Public surface invariants:

- `readTaskFailureSemanticEvidence` remains absent from the root SDK export and
  the `/semantic` export
- the classifier is available only through the workspace-private
  `@tomismeta/aperture-core/internal` seam for Lab audit workflows
- the npm package `exports` map still does not expose `./internal`
- session-bundle and trace schemas do not carry raw classifier evidence yet
- the packaged product remains dependency-free in its runtime package path

Runtime impact:

- source users on current `main`, and consumers of the next npm release, get the
  stricter failed-status classifier
- installed npm consumers remain unaffected until a new package is published
- adapters that provide explicit `toolFamily` or context tool-family evidence
  can still receive bounded failed-status readback handling
- adapters that only place tool-family truth in audit `metadata` no longer get
  that metadata treated as routing evidence
- zero-exit bash outputs and negated or expected exception wording no longer
  enter the `terminal_failure` bucket by phrase alone

Lab impact:

- semantic review candidate reports are schema v2
- the report now includes a failed-task-evidence census with counts by evidence
  kind, tool family, consequence baseline, missing tool-family, and retained
  deterministic examples
- retained failed-evidence examples use the report's per-kind and
  per-session/kind caps, so the shortlist is deterministic and not dominated by
  one session
- failed evidence is counted from raw `publishSource` and direct `publish`
  events, once per failed task update, independently of candidate pressure
  buckets

Representative corpus checkpoint:

- on a 99-bundle public trajectory census, Lab scanned 1,335 failed task
  updates with no invalid bundles
- 180 failed updates read as observations, including 150 routine bash
  zero-exit observations and 30 read/edit observational payloads
- 129 failed updates carried terminal failure evidence
- 1,017 failed updates stayed unclassified and high-baseline, which remains the
  conservative fallback bucket for future review
- no failed evidence in that census depended on missing tool-family truth

Release posture:

- do not cut npm from this branch until `boundary:check`, `sdk:prove`,
  `kernel:conformance`, `kernel:corpus`, product smoke, and a representative
  corpus evidence census have passed
- the release note should describe this as semantic robustness and auditability,
  not a new public classifier API

## Unclassified Failed Evidence Tranche - 2026-07-28

The unclassified-failure tranche upgrades the same internal classifier without
changing the public SDK surface or adding runtime dependencies.

Core semantic changes:

- valid bash `{"wall_time": "...", "output": "..."}` envelopes without an
  `exit_code` are parsed as structured tool output, but the wrapper alone does
  not downgrade failed status
- structured output only becomes an observation when the output is strongly
  source/code-shaped; neutral result summaries stay failure-shaped without
  explicit zero-exit evidence
- explicit nonzero top-level exit codes remain terminal, even when the output is
  source-shaped
- common structured diagnostics, including package-manager errors, compiler
  errors, runtime exceptions, git fatal errors, Rust panics, refused
  connections, and operation-permission failures, remain terminal failures
- read-tool failures carrying strong raw source/code grammar are treated as
  observational payloads with a high consequence baseline
- exact search-result envelopes now read as low-consequence observations rather
  than low-consequence failures; search backend failures remain terminal,
  including colon-form result envelopes
- empty `{}` payloads, malformed JSON, unknown JSON shapes, invalid exit-code
  fields, and ambiguous single-line matches remain unclassified and high

Lab impact:

- semantic review candidate reports are schema v4
- `structured_tool_output_observation` and `empty_failure_payload` are new
  internal failed-task evidence kinds
- retained examples and counts include the new evidence kind; this is a Lab
  report schema change, not a public npm SDK change

Representative corpus checkpoint:

- on the same 99-bundle public trajectory census, Lab scanned 1,335 failed task
  updates with no invalid bundles
- failed updates reading as observations increased from 180 to 247
- terminal failures increased from 129 to 216 after adding concrete terminal
  tool/runtime phrases such as missing files, patch verification failures, and
  assertion/test failures
- unclassified high-baseline failed updates dropped from 1,017 to 872
- the new observation distribution is 150 routine bash zero-exit observations,
  86 observational payloads, and 11 routine search outputs; the representative
  public checkpoint contains no structured bash output observations after the
  stricter diagnostic pass

Transport summary boundary:

- public trajectory importers must preserve `sourceEvent.summary` as semantic
  input up to the work-event summary contract limit; 220/240 character clipping
  is reserved for human-facing excerpts
- structured tool-output summaries must remain valid JSON when clipped; only the
  `output` field may be shortened, while `exit_code` and `wall_time` remain
  parseable
- core may recover incomplete structured tool-output prefixes only through the
  neutral envelope parser: visible nonzero exits and strong diagnostics remain
  terminal, zero exits require non-empty recovered output with valid visible
  fields, and output-only prefixes require strong source/document/log structure
  before becoming observational evidence
- exact empty failed tool payloads are classified as a known high-consequence
  transport-empty failure shape, not as observation

Matched reimport checkpoint:

- on the original DataClaw offset-6 record set, the old importer produced 269
  invalid JSON-like failed summaries across 295 failed updates
- the fixed importer produced 0 invalid JSON-like failed summaries on the same
  19 sessions; all 269 long structured summaries remained parseable JSON
- unclassified failed updates on that matched set dropped from 192 to 105
- structured tool-output observations moved from 0 to 69, terminal failures from
  100 to 113, routine search outputs from 3 to 4, and observational payloads
  from 0 to 4 without adding product-specific phrase rules

## Event Shape Review Tranche - 2026-07-28

The next branch keeps classifier changes corpus-led. Before adding more core
semantic rules, Lab now records structural event-shape clusters for remaining
`unclassified_failure` updates.

Lab impact:

- semantic review candidate reports are schema v5
- failed-task evidence examples include an `eventShape` field
- the failed-task evidence summary includes counts and retained examples by
  unclassified event shape
- event shapes are built from structure only: tool family, JSON validity,
  stable JSON key sets, malformed JSON-like prefixes, payload value type,
  line-number context, source-like grammar, path density, and length buckets
- event shapes must not include raw payload values or product-specific wording

Use:

- run a fresh clean corpus import after the summary-preservation fix
- generate a v5 review-candidates report from the verified manifest
- promote only repeated, source-agnostic event shapes into core semantics

## Structural Envelope Hardening - 2026-07-28

The first core follow-up from the v5 event-shape review keeps the contract
structural. Explicit bash/edit failed-status tool-output envelopes may now be
recovered from truncated prefixes when visible top-level fields before and after
`output` validate and the recovered output has strong source, document, log, or
build shape. Nonzero exit metadata and visible runtime/compiler/test diagnostics
still classify as terminal failures first. Plain wrappers, invalid wall-time or
exit metadata, unknown complete keys, unknown visible suffix fields, empty
output, and generic failed-read text remain unclassified or terminal rather than
observational.

## Human Input Contract

For `human.input.requested`, semantic interpretation is allowed to project into the canonical event more strongly.

That means:

- semantic `consequence` can become canonical `event.consequence`
- semantic tool-family inference can help interpret risk
- semantic `whyNow` and `factors` can enrich provenance

This path is intentionally stronger because the event already represents an explicit operator decision point.

Additional narrowing rule:

- text-only tool-family inference should be treated as strongest on explicit
  approval requests
- question and form requests should prefer explicit source or context tool-family
  truth over wording-based inference
- even when question or form requests carry explicit tool-family metadata, that
  metadata should stay explanatory unless a later contract change deliberately
  promotes it into bounded policy, value, or memory paths
- question and form tool-family metadata should remain semantic-only today; it
  should not be lifted into canonical human-input fields or candidate metadata
  unless a later contract change promotes it deliberately

Why:

- approval requests often name the concrete operation under review
- question and form prompts more often mention tools hypothetically or as part of
  planning language
- that makes wording-only tool inference noisier and less trustworthy on
  question/form paths

## Source Truth Precedence

When explicit source truth exists, it wins over weaker inference.

Examples:

- explicit `toolFamily` beats inferred `toolFamily`
- explicit source activity class beats inferred activity class
- explicit semantic hints beat generic built-in interpretation
- engine-owned evidence beats explanatory semantic factors for named judgment
  diagnostics

This remains a core rule of the semantic architecture.

## Consequences For Implementation

Near-term implementation should follow these rules:

1. do not widen `SemanticInterpretation` further before this taxonomy stays stable
2. keep `task.updated` status routing authoritative except for named, compiled judgment diagnostics
3. keep relation semantics narrow and explicit
4. treat confidence and abstention as visible signals with bounded ambiguity behavior, not hidden score math
5. lock the contract with parity and determinism tests before larger refactors

## Consequences For Docs And Lab

Docs and benchmarks should distinguish between:

- semantic fields that influence routing
- semantic fields that explain or describe the read

Lab should continue asserting both kinds of fields, but the docs should not imply that every asserted semantic field is already a live routing input.
