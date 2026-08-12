# Source Evidence Contract v1

Status: normative for `@tomismeta/aperture-core/kernel`.

`SourceEvidence` is the only typed input boundary between reliable host-native
result facts and Aperture's normalized Observation. It is optional, closed, and
valid only on failed task or work updates.

## Authority

When `evidence` is present, it is authoritative. Title, summary, metadata, and
capability names cannot override its kind, subject, channel, polarity,
diagnostic class, completeness, or execution state. When it is absent, Aperture
may classify the event with its bounded structural text grammar.
Direct-event semantic-default opt-outs do not bypass this authority.

The host supplies source facts only. Core owns and derives:

- Observation kind, polarity, ownership, and subject
- evidence loss, strength, and semantic agreement
- provenance authority and origin
- diagnostic and recovery classification
- baseline consequence and deterministic judgment

Hosts must not construct `NormalizedObservation`, judgment inputs, or judgment
outputs. `facts.capabilityFamily` is opaque identity and may establish ownership
only; its value never implies semantic behavior.

## Variants

`SourceEvidence` is a discriminated union with five structural forms:

| Kind            | Required facts                                                           |
| --------------- | ------------------------------------------------------------------------ |
| `outcome`       | `outcome`, `subject`, `channel`, and `complete: true`                    |
| `diagnostic`    | `runtime` or `expected`, plus `subject`, `channel`, and `complete: true` |
| `diagnostic`    | `source_limit`, `channel: read`, and a measured partial `window`         |
| `payload`       | non-command `subject`, `channel`, and `complete: true`                   |
| `authorization` | `state: required`, `execution: not_started`, and `result: absent`        |

A measured partial window contains an integer `offset`, positive `length`,
positive `total`, and must end before `total`. Its unit is `bytes` or `lines`.

Unknown fields, unknown literals, incomplete variants, and evidence attached to
a non-failed update are invalid. Runtime kernel evaluation validates these rules
before semantic normalization.

## Single Path

Typed evidence and text fallback share one lowering pipeline:

```text
KernelEvent
  -> SourceEvent
  -> private observation syntax
  -> Observation semantics
  -> NormalizedObservation
  -> deterministic judgment
```

The boundary adds no alternate evaluator, host vocabulary, compatibility alias,
runtime dependency, persistence behavior, or adapter implementation to Core.
