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

### What semantic interpretation is allowed to do on `task.updated`

- infer `toolFamily` if the source omitted it
- infer `activityClass` if the source omitted it
- infer `relationHints` for continuity
- provide `whyNow`, `factors`, and `reasons` for provenance and explanation
- provide inspection metadata like `intentFrame`, `confidence`, and `abstained`

### What semantic interpretation is not allowed to do on `task.updated`

- silently override status-derived consequence
- silently turn a passive status into a blocking human-input event
- silently change response-spec shape from status handling into approval/choice/form handling

If Aperture later wants implied asks in status updates to change routing, that must become a deliberate policy decision, not an accidental side effect of richer semantics.

## Human Input Contract

For `human.input.requested`, semantic interpretation is allowed to project into the canonical event more strongly.

That means:

- semantic `consequence` can become canonical `event.consequence`
- semantic tool-family inference can help interpret risk
- semantic `whyNow` and `factors` can enrich provenance

This path is intentionally stronger because the event already represents an explicit operator decision point.

## Source Truth Precedence

When explicit source truth exists, it wins over weaker inference.

Examples:

- explicit `toolFamily` beats inferred `toolFamily`
- explicit source activity class beats inferred activity class
- explicit semantic hints beat generic built-in interpretation

This remains a core rule of the semantic architecture.

## Consequences For Implementation

Near-term implementation should follow these rules:

1. do not widen `SemanticInterpretation` further before this taxonomy stays stable
2. keep `task.updated` status routing authoritative until a later policy change says otherwise
3. keep relation semantics narrow and explicit
4. treat confidence and abstention as visible signals with bounded ambiguity behavior, not hidden score math
5. lock the contract with parity and determinism tests before larger refactors

## Consequences For Docs And Lab

Docs and benchmarks should distinguish between:

- semantic fields that influence routing
- semantic fields that explain or describe the read

Lab should continue asserting both kinds of fields, but the docs should not imply that every asserted semantic field is already a live routing input.
