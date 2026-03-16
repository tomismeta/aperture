# TUI Redesign Spec

This document defines the next TUI evolution after the `0.2.0` engine work.

The goal is not to redesign the terminal surface from scratch.
The goal is to make the TUI reflect the engine's stronger judgment capabilities
without losing the calm, operator-first surface we already have.

It is a spec for the next implementation pass in `@aperture/tui`.

## Core Thesis

The TUI should surface:

- what needs attention now
- enough context to act
- one short explanation of why Aperture put it here

It should not surface:

- raw engine internals by default
- full counterfactual reasoning in operator mode
- a dashboard of every rule and metric at once

The default surface should stay calm.
The deeper judgment layer should be inspectable on demand.

## The Main Change

The current TUI is still frame-first.
The next TUI should become judgment-legible.

That means:

- operator mode stays compact and calm
- the active pane gets one synthesized judgment line
- posture comes from real burden/pressure, not frame tone
- deep inspection moves behind a dedicated `why` mode

## Goals

- Preserve the existing one-focus-pane layout
- Make the active frame easier to trust and act on
- Expose why Aperture made a decision without flooding the operator
- Keep queue and ambient compact
- Add a judgment inspection path for power users and debugging

## Non-Goals

- No inbox rewrite
- No dashboard layout
- No per-item queue explanations in default mode
- No episode/group badges yet
- No source-specific rendering
- No requirement to understand internal scoring to use the TUI

## Interaction Model

The TUI should have two primary modes.

### 1. Operator Mode

This is the default.

It should answer:

- what is this
- what should I do
- why is it here now

### 2. Why Mode

This is opt-in inspection mode.

It should answer:

- why did Aperture choose this route
- which rules fired
- what thresholds applied
- what continuity logic overrode the base route

Primary key:

- `[y]` toggles why mode
- `[esc]` closes why mode

Existing keys stay stable:

- `[space]` expands context
- `[a]`, `[r]`, `[x]`, `[enter]`, `[1-9]`, `[i]` keep their current response meanings

## Operator Surface Changes

### Active Pane

Keep the existing bordered focus pane and overall layout.

Default visible fields:

- title
- source
- mode
- urgency
- risk
- summary
- first 1-2 context items, if present
- one judgment line

### Judgment Line

Add exactly one line beneath the summary/metadata area.

This line should be synthesized from the best available reason, not dump the
entire `rationale[]` array.

Priority order for the chosen line:

1. winning continuity override rationale
2. criterion rationale
3. policy rationale
4. fallback route rationale

Examples:

- `Blocks progress until approved`
- `Queued behind an equally urgent interrupt`
- `Held active to avoid a premature switch`
- `Waiting until signal is stronger`

The line should be:

- one sentence
- plain language
- operator-facing
- truncated to panel width

Do not show:

- raw threshold numbers in operator mode
- rule ids in operator mode
- multiple stacked rationale lines in operator mode

### Context Visibility

Context is operator-relevant, not debug-only.

Change the current behavior so:

- first 1-2 context items are visible by default
- additional context remains behind `[space]`

`[space]` should now mean:

- expand/collapse additional context and provenance detail

It should no longer be the main gateway to judgment reasoning.

### Queue

Keep queue entries compact and scan-friendly.

Default queue entries should remain:

- title
- source
- mode

Do not add per-item explanation lines in operator mode.

Queue is for orientation, not for deep inspection.

### Ambient

Keep ambient quiet and minimal.

No judgment text should appear in ambient by default.

## Header / Statusline Changes

Replace the current posture derivation from frame tone with a posture derived
from real engine state.

Use:

- `attentionBurden`
- optionally pressure as a tie-breaker or contributing input

Recommended labels:

- `calm`
- `elevated`
- `busy`

Recommended mapping:

- `calm`
  - burden `light`
  - pressure not elevated
- `elevated`
  - burden `elevated`
  - or pressure `elevated`
- `busy`
  - burden `high`
  - or pressure `high`

Suggested presentation:

- `○ calm`
- `◐ elevated`
- `● busy`

This should be ambient context, not an alarm banner.

## Why Mode

Why mode is the full judgment inspection layer.

It should be explicitly secondary to operator mode.

### Entry

- `[y]` opens or closes why mode
- `[esc]` closes why mode

### Placement

Preferred first implementation:

- replace or overlay the lower section of the screen
- keep the active frame visible
- use the space currently occupied by queue + ambient for inspection

Do not move the active frame.

### Contents

Why mode should show, for the active frame:

- final decision kind
- candidate score
- current score, if any
- policy gate evaluations
- criterion verdict
- criterion rule evaluations
- continuity evaluations
- final chosen rationale

Suggested sections:

1. `Decision`
2. `Policy`
3. `Criterion`
4. `Continuity`

### Decision Section

Show:

- final route: active / queue / ambient / auto-approve
- candidate score
- current score, if present
- chosen reasons

### Policy Section

Show gate evaluations:

- configured policy
- blocking
- background
- peripheral status
- interruptive default

For each:

- rule name
- noop / verdict
- short rationale

### Criterion Section

Show:

- activation threshold
- promotion margin
- peripheral resolution, if any
- ambiguity, if any
- criterion adjustments from:
  - source trust
  - attention budget
  - operator absence

This is where numeric threshold detail belongs.

### Continuity Section

Show every evaluated continuity rule:

- rule name
- noop / override
- rationale

Highlight the winning override if present.

This section should expose:

- minimum dwell
- conflicting interrupt
- decision stream continuity
- burst dampening
- same interaction / same episode / visible episode
- context patience
- deferral escalation

### Future Extension

Why mode can later add disagreement/counterfactual detail, but that is not
required for the first pass.

Do not require counterfactual rendering for V1 of why mode.

## Data Requirements

The current frame metadata is not enough for full why mode.

The frame already carries:

- `metadata.attention`
- `metadata.episode`

That is enough for operator mode, but not enough for rule-by-rule inspection.

### Required New Read Path

Add a clean advanced read path from core to retrieve the latest explanation for
visible interactions.

Preferred shape:

- a read-only explanation getter keyed by `interactionId`

Examples:

- `core.getDecisionExplanation(taskId, interactionId)`
- or `core.getVisibleJudgment(taskId, interactionId)`

Requirements:

- read-only
- optional
- advanced surface only
- no requirement for simple SDK consumers to use it

### What Not To Do

Do not:

- stuff full coordinator explanations into frame metadata
- pollute the simple `AttentionFrame` shape with all rule evaluations
- make ordinary consumers understand explanation plumbing

## Rendering Rules

### Operator Mode

Priority:

1. act
2. orient
3. lightly explain

### Why Mode

Priority:

1. explain
2. inspect
3. debug

### Score Presentation

Raw score should stay secondary.

In operator mode:

- do not foreground score
- do not require score for understanding

In why mode:

- score is fine to show
- but always show it with threshold/routing context

## Implementation Plan

This should be an additive pass over `packages/tui/src/index.ts`, not a rewrite.

### Phase 1

- add burden-based posture in the statusline
- add default-visible context items
- add one synthesized judgment line to the active pane

### Phase 2

- add explanation access path in core for visible items
- keep it advanced and read-only

### Phase 3

- add why mode toggled by `[y]`
- render policy, criterion, and continuity sections

### Phase 4

- refine wording of the synthesized judgment line
- tune truncation and compact layout behavior

## Acceptance Criteria

The redesign is successful when:

- an operator can understand the active item faster without opening debug detail
- the queue still scans cleanly
- the header communicates system posture more honestly
- a power user can inspect why a frame is active or queued without leaving the TUI
- the TUI still feels calm, not dashboard-heavy

## Example Operator Surface

Active pane:

- `Approve production deploy`
- `Claude Code  permission  needs attention  medium risk`
- `Deployment is waiting for approval.`
- `service: api`
- `branch: release/42`
- `Blocks progress until approved`

Queue:

- `Approve database migration`
- `Review rollout config`

Ambient:

- `Diagnostics uploaded`

Header:

- `active 1   queued 2   ambient 3   ◐ elevated`

## Example Why Mode

Sections:

- `Decision`
  - `route: queue`
  - `candidate score: 1211`
  - `current score: 1211`
  - `reason: equally interruptive work needs a clear advantage`

- `Policy`
  - `blocking -> verdict`
  - `requires operator response`

- `Criterion`
  - `activation threshold: 180`
  - `promotion margin: 20`
  - `peripheral resolution: none`

- `Continuity`
  - `minimum_dwell -> noop`
  - `conflicting_interrupt -> override`
  - `decision_stream_continuity -> noop`

## Summary

The next TUI should not become a debugging console.

It should become:

- calmer for operators
- more legible about judgment
- inspectable when needed

Default mode should answer:

- what is this
- what do I do
- why is it here

Why mode should answer:

- why did Aperture decide this

