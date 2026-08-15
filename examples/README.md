# Examples

This folder is the fastest way to see the current Aperture shapes without
installing extra product features.

There are three useful paths:

- use the product
- build with the SDK
- review a captured session

## Use The Product

If you want the shipped Aperture product, start with:

1. [../README.md](../README.md)
2. [../packages/aperture/README.md](../packages/aperture/README.md)
3. [../docs/product/architecture-overview.md](../docs/product/architecture-overview.md)

If you need to send external work into a running Aperture instance, the
optional local ingress contract is here:

- [../docs/product/host-neutral-ingestion-contract.md](../docs/product/host-neutral-ingestion-contract.md)
- [../docs/product/work-event-mapping.md](../docs/product/work-event-mapping.md)

Canonical `WorkEvent` JSON examples live here:

- [../schemas/examples/work-event/coding-agent-status-waiting.json](../schemas/examples/work-event/coding-agent-status-waiting.json)
- [../schemas/examples/work-event/coding-agent-approval-request.json](../schemas/examples/work-event/coding-agent-approval-request.json)
- [../schemas/examples/work-event/remote-review-choice-request.json](../schemas/examples/work-event/remote-review-choice-request.json)
- [../schemas/examples/work-event/subagent-failure-update.json](../schemas/examples/work-event/subagent-failure-update.json)
- [../schemas/examples/work-event/workflow-completed.json](../schemas/examples/work-event/workflow-completed.json)

The smallest live product example is still a string:

```bash
curl -X POST http://127.0.0.1:4546/work \
  -H 'Content-Type: text/plain' \
  --data 'Waiting for approval before continuing with the deploy.'
```

## Build With The SDK

These runnable repo examples use `@tomismeta/aperture-core` directly:

- [core-full-engine/index.ts](./core-full-engine/index.ts)
  - full `ApertureCore` loop with publish -> frame -> submit
- [core-judgment-primitives/index.ts](./core-judgment-primitives/index.ts)
  - lower-level judgment types and lane reasoning
- [core-kernel-entrypoint/index.ts](./core-kernel-entrypoint/index.ts)
  - host-neutral event -> observation -> judgment projection
- [core-kernel-host-embedder/index.ts](./core-kernel-host-embedder/index.ts)
  - two unrelated host event shapes adapted outside core into the same kernel result
- [core-semantic-entrypoint/index.ts](./core-semantic-entrypoint/index.ts)
  - semantic interpretation and normalization helpers
- [core-trace-entrypoint/index.ts](./core-trace-entrypoint/index.ts)
  - public trace/explainability contract

## Review A Captured Session

If you want to inspect a real run after the fact:

1. capture a bundle with `aperture --capture` or `pnpm session:export`
2. prepare an offline-review artifact with `pnpm session:review`
3. run an offline reviewer with `pnpm lab:fstop:review-run`

The quickest guide is:

- [../docs/lab/capture-review-quickstart.md](../docs/lab/capture-review-quickstart.md)
