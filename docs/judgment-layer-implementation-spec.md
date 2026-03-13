# Judgment Layer Implementation Spec

## Purpose

This document defines the implementation plan for pushing Aperture's core from a deterministic routing engine toward a novel, adaptive judgment engine without adding unnecessary infrastructure or external dependencies.

The goal is to keep the core:

- small
- inspectable
- deterministic where safety matters
- adaptive where operator behavior provides signal

The design should improve user-visible behavior early, while building clean seams for later reasoning and anticipation.

## Design Principles

- The moat lives in the closed loop between presentation, operator action, and future judgment.
- Policy, scoring, and presentation planning must be separate concerns.
- New constructs should only be introduced when they create a real boundary.
- Persistence should be file-based and human-readable.
- No external database is required.
- Optional model-based reasoning may be added later, but it must not become the core decision maker.

## Non-Goals

- No ML training pipeline.
- No external storage service.
- No opaque ranking model in the critical path.
- No broad plugin framework.

## Current Problems

The current engine has three useful strengths:

- deterministic policy and test coverage
- signal capture and recent-history summaries
- lightweight queue-level suppression

The current engine also has three structural limitations:

- blocking is encoded as policy, score, and coordinator override at the same time
- historical signals only produce fixed offsets, not learned profiles
- queue reasoning is still mostly pairwise and frame-oriented

## Target Architecture

The new judgment layer should have three explicit phases:

1. `Policy`
2. `Utility`
3. `Planner`

These are the only new core constructs required for the next phase.

### Policy

Purpose:
determine hard constraints before ranking.

Responsibilities:

- decide whether an interaction may interrupt
- decide whether operator input is required
- enforce consequence floors
- enforce host- or operator-defined guardrails

Properties:

- deterministic
- inspectable
- conservative

### Utility

Purpose:
estimate the value of surfacing an interaction now.

Responsibilities:

- rank interactions that survive policy
- incorporate freshness and expiry
- use operator/session summaries
- adjust for consequence trust

Properties:

- numeric
- explainable as components
- adaptive over time

### Planner

Purpose:
choose how to present work across the whole queue.

Responsibilities:

- activate vs queue vs ambient
- batch related work
- delay low-value work during pressure
- prefer episode-level continuity over fragmented interruptions

Properties:

- queue-aware
- stateful
- still deterministic given the same inputs

## Minimal New Modules

The next implementation phase should introduce only these modules:

- `attention-policy.ts`
- `attention-value.ts`
- `attention-planner.ts`
- `episode-tracker.ts`
- `profile-store.ts`
- `consequence-calibration.ts`

Everything else should continue to reuse existing constructs.

### Existing Modules To Keep

- `EventEvaluator`
- `FramePlanner`
- `TaskViewStore`
- `AttentionSignalStore`
- `AttentionView`
- `ApertureCore`

These should be adapted, not replaced.

## Persistence Layer

Yes, plain Markdown files are good enough for the next stage, with one important constraint:

- store compact durable state in Markdown
- do not store high-volume raw event streams in Markdown

The minimal durable storage surface should be exactly:

- `USER.md`
- `MEMORY.md`
- `JUDGMENT.md`

Nothing else should be introduced until there is a concrete need.

This keeps storage:

- human-readable
- git-friendly
- easy to diff
- dependency-free
- small enough to preserve clear ownership

### Why Markdown Is Acceptable Here

The retained state is small:

- explicit operator preferences
- durable learned summaries
- a few counters, rates, and latencies
- compact source trust adjustments

That is configuration-like state, not database-like state.

Markdown works well because it is both readable and editable, and the volume should remain low if we only persist summaries rather than every raw signal forever.

### Vocabulary Alignment

These file names should be treated as stable archetypes, not as vague prompt files.

The meaning should be:

- `USER.md`: explicit operator preferences and overrides
- `MEMORY.md`: learned durable summaries and calibration state
- `JUDGMENT.md`: explicit attention policy and guardrails

`JUDGMENT.md` is the only noun Aperture needs beyond the borrowed vocabulary. It earns its place because hard attention policy does not fit cleanly inside either user preferences or learned memory.

### Where Files Should Live

Use a dedicated runtime directory under the user data area or project runtime area.

Suggested layout:

```text
.aperture/
  USER.md
  MEMORY.md
  JUDGMENT.md
```

If Aperture already has a better runtime directory convention, use that instead, but keep this same shape.

### Markdown File Format

Use pure Markdown with fixed headings and simple bullet key-value lines.

The v1 house style should be:

- `#` for the document title
- `##` for top-level sections
- `###` for named entries inside a section
- `- key: value` for machine-readable fields
- `- value` for plain bullet lists

This keeps the files fully human-readable and editable without any YAML or JSON layer embedded inside them.

Example `USER.md`:

```md
# User

## Meta
- version: 1
- operator id: default
- updated at: 2026-03-12T10:15:00.000Z

## Preferences
- prefer batching for: status
- always expand context for: destructive_bash
- never auto approve: env_write

## Tool Overrides
### read
- default presentation: ambient

### bash
- require context expansion: true

Explicit operator preferences and hard overrides.
```

Example `MEMORY.md`:

```md
# Memory

## Meta
- version: 1
- operator id: default
- updated at: 2026-03-12T10:15:00.000Z
- session count: 4

## Tool Families
### read
- presentations: 28
- responses: 27
- dismissals: 0
- avg response latency ms: 1800
- context expansion rate: 0.04

### bash
- presentations: 11
- responses: 7
- dismissals: 1
- avg response latency ms: 9200
- context expansion rate: 0.63

## Source Trust
### claude-code / low
- confirmations: 41
- disagreements: 6
- trust adjustment: -0.15

### claude-code / medium
- confirmations: 17
- disagreements: 4
- trust adjustment: -0.08

## Consequence Profiles
### low
- rejection rate: 0.03

### medium
- rejection rate: 0.19

### high
- rejection rate: 0.44

Durable learned summaries and trust calibration.
```

Example `JUDGMENT.md`:

```md
# Judgment

## Meta
- version: 1
- updated at: 2026-03-12T10:15:00.000Z

## Policy
### lowRiskRead
- may interrupt: true
- minimum presentation: active

### lowRiskWeb
- may interrupt: true
- minimum presentation: active

### fileWrite
- may interrupt: true
- minimum presentation: active

### destructiveBash
- may interrupt: true
- minimum presentation: active
- require context expansion: true

### envWrite
- may interrupt: true
- minimum presentation: active
- require context expansion: true

## Planner Defaults
- batch status bursts: true
- defer low value during pressure: true

Explicit attention policy and guardrails.
```

Start conservative, then ratchet bounded categories like `lowRiskRead` or `lowRiskWeb`
down to `auto approve: true` only when that behavior is explicitly desired.

### Persistence Rules

- Write files atomically.
- Keep only the latest summarized state in each file.
- Do not append every signal forever.
- Rebuild summaries from in-memory signals during the session and checkpoint periodically.
- Keep the parser local and tiny.
- Separate human-authored files from machine-authored sections wherever possible.
- Keep short-horizon runtime state derived in memory unless there is a clear need to checkpoint it.

This avoids a file format that becomes an accidental database.

## Boundary Rules

### `AttentionSignalStore`

Keep responsibility:

- collect raw interaction signals for the current process
- provide recent summaries

Do not extend it into a durable store.

### `ProfileStore`

New responsibility:

- load explicit preferences from `USER.md`
- load and save learned durable summaries from `MEMORY.md`
- update summary aggregates from recent signals

It should not rank anything.

### `ConsequenceCalibration`

New responsibility:

- map adapter-declared consequence to trust-adjusted consequence modifiers
- record disagreement and confirmation counts

Persistence:

- store calibration summaries inside `MEMORY.md` under a dedicated `sourceTrust` section

It should not decide final presentation mode.

### `AttentionPolicy`

New responsibility:

- produce a policy verdict for a candidate

Suggested output:

```ts
type AttentionPolicyVerdict = {
  mayInterrupt: boolean;
  requiresOperatorResponse: boolean;
  minimumPresentation: "ambient" | "queue" | "active";
  rationale: string[];
};
```

Policy should not use learned weights.

Persistence:

- load explicit policy and guardrails from `JUDGMENT.md`
- allow user-specific overrides from `USER.md`

### `AttentionValue`

New responsibility:

- compute a score and components for candidates that survived policy

Suggested output:

```ts
type AttentionValueBreakdown = {
  total: number;
  components: {
    baseUrgency: number;
    freshness: number;
    expiry: number;
    operatorAffinity: number;
    contextCost: number;
    consequenceTrust: number;
  };
  rationale: string[];
};
```

Utility should not decide batch vs interrupt.

Persistence:

- use learned summaries from `MEMORY.md`
- use short-horizon state from in-memory signal summaries, not persisted files

### `AttentionPlanner`

New responsibility:

- choose presentation outcome using policy verdicts, attention values, queue context, and episodes

Suggested outcomes:

```ts
type PlannedOutcome =
  | { kind: "activate" }
  | { kind: "queue" }
  | { kind: "ambient" }
  | { kind: "batch"; episodeId: string }
  | { kind: "defer"; until?: string; reason: string };
```

The planner should not mutate profile state.

### `EpisodeTracker`

New responsibility:

- group related interactions into one decision episode

This is a justified new construct because it changes the unit of judgment from frame to decision.

Persistence:

- keep episodes in memory during the active session
- only persist distilled episode lessons into `MEMORY.md` when they become durable patterns

## Decision Episodes

This is the most differentiated construct after the policy split.

An episode represents one operator decision surface that may contain several raw events or candidate interactions.

Examples:

- read, then edit, then bash on the same file path
- repeated blocked updates from the same task
- approval followed by failure followed by resubmission on the same entity

### Episode Identity

Start simple and deterministic.

Build episode keys from:

- `taskId`
- `source.kind`
- interaction family
- normalized file path or entity id if present

Do not use an LLM for episode identity in the initial implementation.

### Episode State

Suggested state:

```ts
type EpisodeState =
  | "emerging"
  | "actionable"
  | "batched"
  | "waiting"
  | "stale"
  | "resolved";
```

### Episode Benefits

- fewer fragmented frames
- easier batching
- better interruption timing
- better traceability for "why now"

Episodes should remain in-memory runtime structure.

They do not need a dedicated persisted file.

If an episode produces a durable lesson, that lesson should be distilled into `MEMORY.md`.

## Utility Scoring Design

The attention value should remain simple and inspectable.

Suggested first-pass components:

- `baseUrgency`
- `freshness`
- `expiry`
- `operatorAffinity`
- `contextCost`
- `consequenceTrust`

### First-Pass Meanings

- `baseUrgency`: derived from consequence, tone, and blocking class without hard overrides
- `freshness`: recent items get a positive lift, stale items decay
- `expiry`: items with shrinking action windows get a lift
- `operatorAffinity`: patterns like "responds quickly to read approvals"
- `contextCost`: penalty when similar items usually require context expansion
- `consequenceTrust`: source-specific trust adjustment

### Explicitly Avoid

- huge magic constants
- hidden model outputs
- direct planner logic inside the attention value

## Profile Store Design

The initial profile store should operate at session scope and optionally checkpoint to disk.

### Dimensions To Track

- by tool family
- by source kind
- by frame mode
- by declared consequence level

### Metrics To Track

- presentations
- responses
- dismissals
- deferrals
- average response latency
- average dismissal latency
- context expansion rate
- return-after-deferral rate

That is enough for adaptation without pretending to be a learning platform.

## File Ownership And Process Mapping

The three-file design only works if each file has a clear owner and clear read/write rules.

### `USER.md`

Truth type:

- explicit operator intent

Primary writer:

- human operator

Allowed machine writer:

- none by default

Primary readers:

- `AttentionPolicy`
- `ProfileStore`

Allowed contents:

- explicit preferences
- explicit overrides
- opt-in behavior constraints

Forbidden contents:

- learned statistics
- inferred preferences
- source calibration data
- short-horizon session state

Rule:

- Aperture may read `USER.md` at startup and refresh on change, but should not silently rewrite it.

### `MEMORY.md`

Truth type:

- learned durable summaries

Primary writer:

- `ProfileStore`

Supporting writer:

- `ConsequenceCalibration`

Primary readers:

- `AttentionValue`
- `ProfileStore`
- optional trace/evaluation tools

Allowed contents:

- aggregate counts and rates
- average latencies
- context expansion rates
- source trust adjustments
- durable distilled lessons

Forbidden contents:

- hard policy rules
- temporary queue state
- unresolved live episode state
- raw append-only signal history

Rule:

- writes should be periodic, summarized, and atomic
- memory is inferred state, so machine writes are expected

### `JUDGMENT.md`

Truth type:

- explicit attention policy

Primary writer:

- human operator or application author

Allowed machine writer:

- none by default

Primary readers:

- `AttentionPolicy`
- `AttentionPlanner`

Allowed contents:

- interruption guardrails
- minimum presentation rules
- bounded auto-approval rules
- planner defaults
- context expansion requirements

Forbidden contents:

- learned behavior summaries
- raw statistics
- operator identity/preferences that belong in `USER.md`

Rule:

- Aperture should read `JUDGMENT.md` as configuration, not as memory
- `JUDGMENT.md` should only expose accepted values that are consumed by live code
- operator-response work should remain `active` unless Aperture has an explicit auto-resolution path such as `auto approve`

## Runtime Process Flow

The core runtime should remain simple and composable.

### Startup Flow

1. `ProfileStore` loads `USER.md`.
2. `ProfileStore` loads `MEMORY.md`.
3. `AttentionPolicy` loads `JUDGMENT.md`.
4. `ApertureCore` initializes in-memory signal and episode trackers.

### Publish Flow

1. `EventEvaluator` converts an event into a candidate.
2. `AttentionSignalStore` provides recent task/global summaries.
3. `EpisodeTracker` assigns the candidate to an episode.
4. `AttentionPolicy` evaluates hard constraints using:
   - candidate data
   - `USER.md` overrides
   - `JUDGMENT.md` policy
5. `ConsequenceCalibration` provides trust adjustments using `MEMORY.md`.
6. `AttentionValue` computes value using:
   - candidate data
   - signal summaries
   - durable memory from `MEMORY.md`
7. `AttentionPlanner` decides presentation using:
   - policy verdict
   - attention value
   - attention view
   - episode context
8. `FramePlanner` converts the result into a frame update.

### Response Flow

1. `ApertureCore.submit()` records response signals.
2. `AttentionSignalStore` updates in-memory summaries.
3. `EpisodeTracker` updates episode state.
4. `ProfileStore` updates rolling learned aggregates.
5. `ConsequenceCalibration` updates trust aggregates if the response implies disagreement or confirmation.
6. periodic checkpoint writes updated summaries into `MEMORY.md`.

### Checkpoint Flow

1. read current in-memory aggregates
2. merge into durable memory model
3. atomically rewrite `MEMORY.md`

No checkpoint should write to `USER.md` or `JUDGMENT.md`.

## Composability Rules

To keep the architecture tight:

- `AttentionPolicy` may read `USER.md` and `JUDGMENT.md`, but not `MEMORY.md`
- `AttentionValue` may read `MEMORY.md`, but must not read `JUDGMENT.md` directly
- `AttentionPlanner` may consume policy verdicts and utility outputs, but must not parse files itself
- `ProfileStore` owns persistence for learned memory
- `ConsequenceCalibration` contributes data to `MEMORY.md`, but does not own file I/O
- `EpisodeTracker` remains runtime-only unless a durable summary is intentionally distilled into `MEMORY.md`

That separation is what keeps the system understandable even as it gets smarter.

## Consequence Calibration Design

The calibration layer should track whether declared consequence levels align with operator behavior.

### Disagreement Signals

Treat these as evidence that declared consequence may be wrong:

- low-consequence item is rejected
- low-consequence item consistently requires context expansion
- medium item is dismissed instantly most of the time
- high item is repeatedly delayed with no later consequence

### Calibration Output

Keep the output modest:

- numeric trust adjustment
- optional adjusted utility component
- rationale for trace output

Do not silently rewrite adapter data.

The original adapter-declared consequence should always remain visible in traces.

## Trace Changes

`ApertureTrace` should be expanded to reflect the three-layer architecture.

Suggested additions:

```ts
type JudgmentTrace = {
  policy: {
    mayInterrupt: boolean;
    requiresOperatorResponse: boolean;
    minimumPresentation: "ambient" | "queue" | "active";
    rationale: string[];
  };
  utility: {
    total: number;
    components: Record<string, number>;
    rationale: string[];
  };
  planner: {
    outcome: "activate" | "queue" | "ambient" | "batch" | "defer";
    rationale: string[];
  };
  episode?: {
    id: string;
    state: string;
    eventCount: number;
  };
  calibration?: {
    source?: string;
    declaredConsequence: "low" | "medium" | "high";
    trustAdjustment: number;
    rationale: string[];
  };
};
```

This is critical for building later evaluation without adding a separate analytics system.

## Implementation Order

### Milestone 1: Split Current Logic

Deliverables:

- extract `attention-policy.ts`
- extract `attention-value.ts`
- extract `attention-planner.ts`
- preserve current behavior as closely as possible
- update traces to show the three decisions separately

Success criteria:

- no meaningful regression in current tests
- traces clearly show policy, utility, and planner decisions

### Milestone 2: Introduce Episodes

Deliverables:

- add `EpisodeTracker`
- group related candidates before planning
- allow planner to batch correlated interactions

Success criteria:

- queue churn drops for correlated multi-step work
- related interactions stop competing as separate urgent items

### Milestone 3: Add Session Profile Persistence

Deliverables:

- add `ProfileStore`
- persist rolling summaries to Markdown
- feed operator/session priors into utility scoring

Success criteria:

- behavior adapts within a session and across restarts
- persistence stays readable and small

### Milestone 4: Add Consequence Calibration

Deliverables:

- add `ConsequenceCalibration`
- persist trust adjustments to Markdown
- expose calibration rationale in traces

Success criteria:

- obviously miscalibrated sources become less noisy over time

### Milestone 5: Planner Pressure Logic

Deliverables:

- queue pressure heuristics in the planner
- batch or defer low-value work during bursts

Success criteria:

- better handling of multi-source bursts
- low-value items do not steal focus during urgent periods

## Why This Can Be Better Than An LLM

An LLM can help with language and semantic interpretation, but it is not the moat by itself.

If Aperture becomes "send the queue to an LLM and ask what to do," it will be easy to copy and hard to trust.

The moat should come from things LLMs do not naturally own:

- longitudinal operator memory
- queue dynamics across time
- consequence calibration by source
- deterministic guardrails
- counterfactual traces tied to real operator behavior
- episode continuity across many small events

That is durable product value even if frontier models improve dramatically.

## Optional Future Model Integration

Model integration should be optional, late, and advisory.

Do not add it in the next milestone.

### Where A Model Could Help Later

- infer better episode grouping when simple deterministic keys are ambiguous
- summarize why a cluster of events belongs together
- suggest context shaping for a frame
- generate natural-language rationale for a planner decision
- propose utility features from traces during offline evaluation

### Where A Model Should Not Own The Decision

- hard policy gating
- final consequence guardrails
- whether destructive work may auto-interrupt
- silent suppression of high-consequence work

### Minimal Future Seam

If we want to prepare for this without overbuilding, define one optional interface only:

```ts
type ReasoningAdvisor = {
  advise(input: {
    candidate: InteractionCandidate;
    taskSummary: SignalSummary;
    globalSummary: SignalSummary;
  }): {
    utilityAdjustments?: Record<string, number>;
    episodeHints?: { key?: string; rationale?: string[] };
    contextHints?: { defaultExpandedSections?: string[] };
    rationale?: string[];
    confidence?: number;
  };
};
```

This should be:

- optional
- off by default
- advisory only
- ignored by policy if confidence is weak

That leaves room for:

- a local model
- a hosted API
- no model at all

without changing the core architecture.

## Recommended Next PR Sequence

1. Extract `attention-policy.ts` from current coordinator behavior.
2. Extract `attention-value.ts` from current score and heuristic logic.
3. Replace coordinator internals with `attention-planner.ts`.
4. Expand trace schema in `trace.ts` and `aperture-core.ts`.
5. Add `EpisodeTracker` with deterministic grouping.
6. Add `ProfileStore` with Markdown persistence.
7. Add `ConsequenceCalibration`.

## Final Recommendation

Keep the next stage aggressively simple.

The right wedge is not "an LLM that decides attention."
The right wedge is:

- a compact judgment core
- persistent operator-specific memory
- traceable queue planning
- optional later reasoning assistance

That creates something an LLM can enhance, but not easily replace.
