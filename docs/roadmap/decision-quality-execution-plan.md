# Decision Quality Execution Plan

This note turns the current strategy call into one near-term execution sequence.

It exists to answer:

**What should Aperture do next if the priority is better individual decisions,
clearer decision discoverability, and stronger operator trust?**

## Top-Line Recommendation

Do not broaden right now.

For the next tranche, Aperture should prioritize:

1. **semantic decision quality**
2. **decision discoverability**
3. **real-world disagreement and replay evidence**

Not:

- more continuity invention
- more adapters for breadth
- Codex plugin implementation
- surface polish that is not tied to clearer trust

## Why This Is The Right Sequence

Recent work already moved **Routing and Continuity** meaningfully forward on
`main`.

The sharper trust gap now is:

- whether Aperture parsed the incoming situation correctly
- whether the operator can tell why it made that decision

That means the highest-value next work sits primarily in:

- **Pillar 1: Structured Semantics**
- **Pillar 6: Traceability and Replay**
- with supporting work in **Pillar 4: Surface Fit**

## Execution Sequence

### Branch 1: `codex/semantic-contract-maturation`

Purpose:

- make the semantic contract tighter, more deterministic, and easier to test

Primary outcomes:

- a clear semantic field taxonomy
- stronger abstention and confidence boundaries
- influence-matrix tests that say which semantic fields affect routing and which
  do not
- broader harvested or replay-backed semantic examples

Primary code seams:

- `packages/core/src/semantic-interpreter.ts`
- `packages/core/src/semantic-detection.ts`
- `packages/core/src/semantic-normalizer.ts`
- semantic contract tests in `packages/core/test/*.test.ts`
- Lab or replay fixtures that lock parser behavior

Concrete goals:

1. make explicit which semantic fields are:
   - decision-bearing
   - explanation-only
   - confidence or abstention signals
2. prefer explicit source truth over inference consistently
3. make inference narrower and more reviewable where needed
4. add tests for:
   - allowed inference
   - required abstention
   - non-influential fields staying non-influential
5. pressure-test the contract against real harvested examples, not only
   synthetic scenarios

Exit criteria:

- semantic contract rules are more explicit than the current phrase-heuristic
  reality
- influence tests exist for the important fields
- harvested or replay-backed examples cover known ambiguous and failure-prone
  cases

### Branch 2: `codex/decision-discoverability`

Purpose:

- make Aperture's individual decisions easier for operators and developers to
  inspect and trust

Primary outcomes:

- semantics become first-class in traces
- the `why` surface shows the semantic reading, not just the downstream routing
  mechanics
- disagreement capture gets easier

Primary code seams:

- `packages/core/src/trace.ts`
- `packages/core/src/trace-recorder.ts`
- `packages/tui/src/render-why.ts`
- any small supporting types needed to expose semantic provenance cleanly

Concrete goals:

1. show, for each candidate decision:
   - intent frame
   - tool family
   - consequence
   - relation hints
   - confidence
   - abstained or not
2. show semantic provenance:
   - explicit from source
   - inferred by core
   - provided through semantic hints
3. make it easier to see when semantics influenced routing versus when they were
   only explanatory
4. make disagreement review cheaper through clearer traces and replay artifacts

Exit criteria:

- semantic interpretation is visible in traces as a first-class decision artifact
- the `why` view explains semantic readings clearly enough to debug individual
  decisions without reading code first

## What To Avoid During These Branches

- do not widen the public SDK casually
- do not keep layering continuity rules without fresh evidence
- do not turn decision discoverability into a large TUI redesign
- do not build the Codex plugin now; keep that work in readiness mode

## Release Guidance

Do not publish immediately just because the branches exist.

Recommended order:

1. finish the semantic-contract tranche
2. finish or meaningfully start the decision-discoverability tranche
3. dogfood both
4. then consider `@tomismeta/aperture-core@0.5.0`

Continue holding `@tomismeta/aperture@0.1.2` until there is a clearer
product-facing tranche.

## Product Framing

The product ladder remains:

- **Paperclip** is the distribution wedge
- **Aperture Core** is the moat-bearing engine
- **Aperture** is the operator-facing attention surface users grow into as the
  attention problem becomes undeniable

The next work should strengthen that ladder by making Aperture more right and
more legible, not by making it broader.
