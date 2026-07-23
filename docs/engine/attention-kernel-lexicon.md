# Attention Kernel Lexicon

This note names the public and internal words for Aperture's deterministic
attention judgment work.

The package remains `@tomismeta/aperture-core`. Public API language should use
`Core SDK` for the stateful engine and `attention evaluator` for the pure
claim-to-record primitive. The word `kernel` is reserved for internal
architecture, replay, and conformance discussions.

| Term                    | Use It For                                                                                                                      | Do Not Use It For                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Core SDK                | The npm package and embeddable TypeScript API.                                                                                  | A specific judgment record or route.                                                              |
| ApertureCore            | The stateful event loop: publish events, maintain surfaced state, accept responses, and emit traces.                            | A pure one-claim evaluator.                                                                       |
| attention evaluator     | The pure public primitive that evaluates one attention claim against explicit context, config, and clock input.                 | Runtime hosting, adapters, persistence, replay sessions, UI state, or human response application. |
| attention kernel        | The internal deterministic judgment architecture and conformance target.                                                        | Public stateful API names such as `createAttentionKernel`, `apply`, or `snapshot`.                |
| SourceEvent             | Adapter-facing source-native facts before normalization.                                                                        | Final semantic meaning.                                                                           |
| ApertureEvent           | Canonical event meaning consumed by Core after normalization or direct publishing.                                              | Host-native payloads that still need mapping.                                                     |
| semantic interpretation | Rich meaning inferred from source facts and bounded hints.                                                                      | The compact ontology or final judgment.                                                           |
| attention ontology      | Compact stable vocabulary consumed by judgment and conformance.                                                                 | Full prose explanation, relation-target detail, or arbitrary source metadata.                     |
| attention claim         | The core-owned demand on attention handed into deterministic judgment.                                                          | Raw source events, host-native payloads, or mutable presentation state.                           |
| evidence/context        | Current operator, surface, pressure, burden, episode, and attention facts supplied to judgment.                                 | Source facts or semantic inference.                                                               |
| judgment                | The deterministic evaluation act over a claim and evidence.                                                                     | The rendered UI frame itself.                                                                     |
| decision record         | The versioned evaluator output: route, planned lane, evidence snapshot, policy, value, ambiguity, continuity, and reason codes. | Realized placement after Core mutates state.                                                      |
| evaluatedAt             | The explicit clock used for deterministic evaluation.                                                                           | The source occurrence time; keep that in `AttentionClaim.timestamp`.                              |
| route                   | The planned decision path: activate, queue, ambient, or auto-approve.                                                           | The final rendered bucket after materialization.                                                  |
| planned lane            | The lane implied by the route before materialization.                                                                           | The final bucket if continuity or surface constraints change placement.                           |
| realized lane           | The lane where the candidate actually lands after Core applies the decision.                                                    | Evaluator output or the route itself.                                                             |
| AttentionFrame          | A human-facing surfaced item.                                                                                                   | The full current attention surface.                                                               |
| AttentionView           | The current now, next, and ambient surface state.                                                                               | A historical trace or benchmark report.                                                           |

Preferred public API language:

- `new ApertureCore(...)`
- `core.publish(...)`
- `core.publishSourceEvent(...)`
- `core.getAttentionView()`
- `core.submit(...)`
- `evaluateAttention(...)` from `@tomismeta/aperture-core/evaluator`
- `AttentionDecisionRecord`

Avoid public API language that implies a second stateful engine:

- `createAttentionKernel(...)`
- `kernel.apply(...)`
- `kernel.snapshot()`
- `kernel.trace()`
- `kernel.explain(...)`
- `replayAttentionKernel(...)`

Compatibility notes:

- Replay snapshots still carry the legacy `resultLane` field. Kernel-facing
  projections and public judgment summaries should say `realizedLane`.
- The older `SemanticOntology*` type names remain aliases. New docs and tests
  should prefer `AttentionOntology*`.
- `AttentionOntologyDiagnostic.source` is the compatibility field for ontology
  authority/provenance. Do not introduce a competing `authority` field without a
  future major-version plan.
- `judgment` is the decision act; `attention` is the managed resource; `kernel`
  is the internal deterministic architecture and conformance shorthand.
