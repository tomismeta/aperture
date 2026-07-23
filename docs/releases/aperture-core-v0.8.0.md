# Aperture Core SDK v0.8.0

`@tomismeta/aperture-core@0.8.0` adds a narrow public evaluator subpath while
keeping the root SDK focused on the stateful Core engine.

## Highlights

- adds `@tomismeta/aperture-core/evaluator`
- exposes `evaluateAttention({ claim, context, config, now })`
- returns a versioned `AttentionDecisionRecord`
- preserves `claim.timestamp` and records the evaluation clock as `record.evaluatedAt`
- uses `context.current` as the single public current-frame input
- keeps `ApertureCore` as the stateful event, surface, response, and trace loop
- keeps kernel/replay language internal to architecture and Lab conformance

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
