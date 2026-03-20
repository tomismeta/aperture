# JudgmentBench Data Strategy

This note defines how JudgmentBench should acquire data, how that data should
be structured, and how public seed data relates to Aperture's own harvested
attention telemetry.

It is a data strategy note, not a benchmark-result note.

## Main Rule

Public data is useful for seeding scenarios.

Proprietary attention telemetry is what makes JudgmentBench hard to copy.

That means:

- use public datasets to bootstrap scenario shapes and stress cases
- use Aperture's own telemetry to build the real benchmark moat

## What We Need To Collect

JudgmentBench should not collect raw everything.

It should collect compact, replayable, attention-significant bundles.

The main bundle types should be:

### 1. Golden scenario

A hand-authored deterministic replay case.

Used for:

- regression protection
- doctrine coverage
- fast local development

### 2. Session bundle

A redacted harvested bundle from a real host session.

Used for:

- shadow evaluation
- real-world replay
- benchmark growth

### 3. Episode slice

A focused decision stream extracted from a larger session.

Used for:

- continuity analysis
- queue-vs-interrupt analysis
- ranking comparisons

## What A Session Bundle Should Preserve

The session bundle should preserve the parts of a session that matter for
attention judgment:

- source events
- normalized Aperture events
- attention-view transitions
- traces
- submitted responses
- silent interaction signals
- compact outcome summaries

It should avoid preserving:

- chain-of-thought
- unnecessary token-by-token deltas
- irrelevant execution chatter
- high-volume implementation detail that never influenced attention

The unit we want is an **attention telemetry bundle**, not a raw execution log.

## Best Initial Data Sources

### 1. Golden scenarios written by us

This is the best first source.

Why:

- highest signal
- doctrine-aligned
- deterministic
- immediately useful for regression testing

These should cover:

- interrupt-worthy approvals
- queue-worthy but meaningful work
- passive ambient status
- overload suppression
- continuity and minimum dwell
- defer-return patterns
- cross-source ordering
- semantic robustness cases such as:
  - dangerous wording without explicit risk hints
  - low-risk read wording
  - implied asks in status text
  - dramatic but passive language
  - explicit host semantic overrides

### 2. Shadow-mode Aperture sessions

This is the most important real data source.

Run Aperture alongside a real host path and record:

- what events arrived
- what Aperture would have surfaced
- what the human actually did
- what traces and signals were recorded

This gives us real operator-attention evidence without forcing Aperture into
the live path first.

Best near-term shadow-mode hosts:

- Aperture adapters
- Aperture TUI sessions
- the Paperclip plugin
- future SDK hosts

### 3. Public seed data

This is useful, but only as seed material.

Good candidates:

- [GH Archive](https://www.gharchive.org/)
  - massive public GitHub event history
  - useful for workflow-pattern mining
- [GitHub event and review docs](https://docs.github.com/en/enterprise-server%403.17/actions/reference/workflows-and-actions/events-that-trigger-workflows)
  - useful for approval-like workflow semantics
- [tau-bench](https://github.com/sierra-research/tau-bench)
  - useful example of historical trajectories as benchmark input
- [AgentRewardBench](https://github.com/McGill-NLP/agent-reward-bench)
  - useful example of trajectory-based offline evaluation
- [AgentProcessBench](https://arxiv.org/abs/2603.14465)
  - useful example of step-level process evaluation

These are helpful for:

- scenario templates
- failure patterns
- approval or review workflow shapes
- stress cases

They are not the core JudgmentBench moat.

## Harvesting Strategy

The harvesting strategy should happen in phases.

## Trust Boundary

Session harvesting should preserve trust by keeping collection local by default.

The recommended ownership split is:

- `@tomismeta/aperture-core`
  - exposes traces, signals, responses, and attention-view state
  - does not send telemetry to any central service
- runtime or host packages such as `@aperture/runtime`, adapters, or SDK hosts
  - record local sessions
  - apply de-identification and redaction
  - export replayable bundles
- `@aperture/lab`
  - defines bundle shape
  - validates imported bundles
  - replays them offline

If a central contribution path exists later, it should be:

- opt-in
- outside core
- based on explicitly exported bundles
- reviewable by the user before submission

### Phase 1. Golden scenarios only

Hand-author a strong initial set of deterministic scenarios.

Goal:

- make the replay lab immediately useful

### Phase 2. Session bundle export

Add export helpers that can capture a redacted session bundle from:

- traces
- signals
- view transitions
- responses
- normalized events

Goal:

- make real sessions replayable offline
- do so without making core or the hot path feel like vendor telemetry plumbing

### Phase 3. Shadow mode

Run Aperture in observation mode inside hosts and record:

- incoming events
- Aperture's predicted surface
- actual operator outcomes

Goal:

- compare current host behavior against Aperture judgment without changing the
  live path

### Phase 4. Episode extraction and labeling

Cut larger sessions into episode slices and add stronger labels to the most
important ones.

Goal:

- get high-quality benchmark slices without having to label every full session

## Labeling Strategy

JudgmentBench should use both weak and strong labels.

### Weak labels

Derived from behavior:

- response kind
- response latency
- dismissal
- defer/return
- context expansion
- ignore or timeout

Weak labels scale well and come naturally from live use.

### Strong labels

Human adjudication on selected scenarios:

- should this have interrupted?
- should this have queued?
- was this ranking right?
- was the explanation faithful?

Strong labels are expensive, so they should be applied selectively to:

- high-value scenarios
- ambiguous scenarios
- regressions
- benchmark anchor cases

## Redaction And Privacy

JudgmentBench should be built around redacted bundles by default.

Keep:

- timing
- task identity
- interaction identity
- semantic event type
- response type
- consequence/tone
- trace explanations

Redact or minimize:

- raw file contents
- long freeform source dumps
- secrets
- irrelevant payload detail

The benchmark needs replayable judgment evidence, not maximum raw fidelity.

De-identification should happen before a bundle leaves the runtime or host.

At minimum, export should avoid or transform:

- raw repository names
- absolute local paths
- stable personal identifiers
- raw prompts or freeform text when semantic summaries are enough
- secrets and tokens

The default exported unit should be a de-identified local bundle that is safe
for replay first, and only optionally shareable later.

## What The First Export Shape Should Look Like

The first session-bundle export should be simple.

At minimum:

- `sessionId`
- `source`
- `events`
- `responses`
- `signals`
- `traces`
- `viewSnapshots`
- `outcomes`

That is enough to:

- replay
- score
- compare
- slice later

## What Public Data Is Good For

Public data is good for:

- approval-flow templates
- review workflow patterns
- issue/PR escalation shapes
- event density and burst patterns
- synthetic stress generation

Public data is weak for:

- true attention labels
- interruption quality
- real defer/return behavior
- explanation faithfulness

That is why public data should seed the system, not define it.

## Recommendation

JudgmentBench should build its data moat in this order:

1. golden scenarios
2. redacted session-bundle export
3. shadow-mode harvesting in live hosts
4. episode extraction
5. selective human labeling
6. public seed-data mining as a scenario generator, not as the main corpus

That path gives Aperture the best chance to own the benchmark for deterministic
human attention judgment instead of borrowing someone else's dataset and hoping
it maps cleanly.
