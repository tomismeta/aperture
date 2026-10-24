# Aperture v0.10.0

`@tomismeta/aperture@0.10.0` bundles Core `0.10.0`, makes attention and response
lifecycles more reliable, and carries the external-surface and OMP integration
work developed since the `0.5.0` npm release.

## Safer Decisions And Clearer Responses

The bundled engine preserves explicit source risk floors, centralizes generic
command-risk inference, and prevents required-reason approvals from being
auto-approved. Result-ready completion metadata cannot hide high-consequence,
blocking, or response-required work.

Responses are validated against the live request before they affect state or
learning. The TUI supports required approval reasons, keeps invalid numeric form
input editable, and omits blank optional numeric fields rather than submitting
an invalid number.

An accepted remote response is kept distinct from a subsequent refresh failure.
Snapshot refreshes are serialized so an older result cannot overwrite newer
attention. A refresh problem is not evidence that the human decision was
rejected or should be submitted again.

## Honest Interaction Lifecycles

- OpenCode replies are scoped to the originating server URL and directory.
  Separate bridges can reuse native IDs without receiving one another's answers.
- A question answered or rejected natively in OpenCode retracts its exact
  Aperture interaction instead of manufacturing a human answer.
- Work cancellation and expiry also retract attention without fabricating an
  acknowledgement or response.
- Work-response retention applies only to Work-originated requests; source
  adapters retain ownership of their native request lifecycles.
- Work admission returns HTTP `503` when pending capacity is exhausted, rather
  than evicting a pending request. Batch admission is atomic, and a zero-TTL
  request expires without briefly creating actionable attention.
- HTTP responses after Work cancellation or expiry are rejected. Expiry remains
  demand-driven, not an idle deadline timer. An accepted in-process Core response
  remains an authoritative fact rather than being silently erased by the Work
  ledger's retention policy.

Core also isolates caller and listener snapshots, serializes learning
checkpoints, preserves correction accounting, and notifies subscribers when
engagement expires. See the [Core migration notes](./aperture-core-v0.10.0.md)
for stricter response and cloneable-data requirements.

## External Surfaces And OMP

The product adds a bounded, snapshot-only JSONL surface for local companion
renderers and public OMP attention-event, focus-host, and worker-direct-message
contracts. Public surface protocol `4` carries no executable navigation,
responses, engagement controls, or runtime credentials.

The separate signed-worker channel contains a self-contained, dependency-free
OMP worker and a compiled first-class OMP extension. It does not require the
Aperture CLI, local runtime, npm, or `node_modules` on the Omarchy host. The worker
requires host-provided Node `22` or newer.

The OMP path includes:

- typed approval, input, failure, provisional completion, resolution, and
  shutdown facts, with stable agent-run and interaction identity
- direct-delivery receipts, bounded retry and restore behavior, session
  liveness, and protection against duplicate native notification fallback
- optional bounded session labels and facets, projected after Core judgment
- opaque, volatile Open Session capabilities for supported Herdr, Foot, and
  tmux contexts; focus loss does not imply an unread result was consumed
- worker-owned durable attention dismissal, which is never an OMP answer,
  approval, cancellation, or command execution

Private OMP-worker output protocol `5` remains independent from public surface,
OMP attention-event, and worker-direct protocols, which remain `4`. Package
version changes do not themselves change these wire versions. The private OMP
component remains `0.2.0`.

## Upgrade And Delivery Boundaries

The coordinated npm packages are `@tomismeta/aperture@0.10.0` and
`@tomismeta/aperture-core@0.10.0`. The product bundles Core at build time; it does
not add an npm runtime dependency on the SDK.

Custom Work clients should preserve authentication, handle capacity rejection,
and narrow `WorkResponse` on its state before reading an answer. Custom surfaces
must satisfy the offered response spec, including required reasons and valid
form values. Old capture data may need correction before replay under the
stricter Core boundary.

Omarchy receives the updated engine through an authenticated signed worker
release and a separate plugin release, not through `npm update`. Installed plugin
updates and restarting already-running OMP sessions are separate operator steps.
This release does not claim Omarchy catalog readiness or remove the stock
pre-remove lifecycle limitation.

Claude Code remains the primary product integration. OpenCode is supported;
Codex hooks remain opt-in and experimental, and Pi remains source-only.

## Qualification

`pnpm release:check` combines the upstream test and deterministic-judgment gates
with packed SDK and product consumer proofs, Work and OMP contract proofs,
external-surface schema checks, and focus fixtures. The worker release workflow
additionally requires an authorized signed tag, exact-commit protected-main CI,
authenticated build metadata, payload verification, and worker/extension smokes.

Fixture, package, and CI checks do not replace native-host verification. The
OpenCode lifecycle and downstream stock Omarchy graphical journey have distinct
host gates. Release receipts record the actual source commit, CI, and artifacts.

## Links

- [Product guide](../../packages/aperture/README.md)
- [Core SDK v0.10.0](./aperture-core-v0.10.0.md)
- [Work contract](../product/host-neutral-ingestion-contract.md)
- [OMP integration](../../packages/omp/README.md)
- [Previous npm product release](./aperture-v0.5.0.md)
