# Interaction Signals

## Purpose

This document captures a broader part of the Aperture vision:

**human response is not limited to explicit response**

Aperture should eventually learn not only from what a human explicitly submits, but also from the interaction context around that response.

That includes:

- what they respond to quickly
- what they defer
- what they ignore
- what they expand for more detail
- what they compare before deciding
- what they do not act on when other frames are present

This is a core part of the engine.

## Core Thesis

The explicit `AttentionResponse` is only one signal.

The broader intelligence comes from:

- explicit response
- implicit attention signals
- relative behavior across multiple active frames
- longitudinal interaction patterns over time

That means Aperture should eventually understand human interaction as:

**a signal field, not just a submitted answer**

## Why This Matters

If Aperture only learns from explicit responses, it can know:

- what the human chose
- what they submitted
- when they completed the interaction

But it cannot know enough about:

- urgency perception
- hesitation
- confusion
- disinterest
- prioritization behavior
- attention tradeoffs across concurrent frames

Those are exactly the signals that matter if Aperture is going to improve interaction judgment over time.

## Signal Categories

### 1. Explicit Signals

These are direct, intentional human responses.

Examples:

- approval
- rejection
- form submission
- dismissal

Current artifacts:

- `AttentionResponse`
- `InteractionSignal` with current engine signals:
  - `presented`
  - `viewed`
  - `responded`
  - `dismissed`
  - `deferred`
  - `context_expanded`
  - `context_skipped`
  - `timed_out`
  - `returned`
  - `attention_shifted`

### 2. Temporal Signals

These describe when and how quickly a response occurred.

Examples:

- time-to-first-attention
- time-to-decision
- time-to-dismissal
- time spent between reveal and submission
- whether a frame was deferred and revisited

These signals help Aperture infer:

- urgency
- confidence
- ambiguity
- friction

### 3. Comparative Signals

These come from the relationship between multiple frames shown in the same period.

Examples:

- which frame got acted on first
- which frame was ignored while another was handled
- which frame repeatedly lost attention to others
- which frame triggered detail inspection before action

These signals matter because human attention is relative, not absolute.

### 4. Structural Signals

These come from how the human interacted with parts of the frame itself.

Examples:

- which provenance was opened
- which details were never inspected
- whether the human acted without expanding context
- whether they bounced between sections before deciding

These signals help Aperture learn:

- what context was actually useful
- what context was excessive
- what information should be foregrounded next time

### 5. Silent Signals

These are the most important long-term category.

Silent signals include:

- frames not responded to
- frames deferred while others were prioritized
- details not opened
- options not considered
- repeated omission patterns across similar decisions

This is where Aperture starts learning from absence, not just presence.

## Silence As Signal

Silence should not be treated as empty data.

Silence can mean:

- the frame was low priority
- the frame was unclear
- the frame was not trusted
- the frame was crowded out by a competing frame
- the frame did not require enough attention to merit action yet

That means:

**what the human does not respond to is often as informative as what they do respond to**

Especially when interpreted in the context of:

- other simultaneously presented frames
- consequence level
- time pressure
- prior interaction patterns

## Multi-Frame Context

The value of these signals increases sharply when multiple frames coexist.

In a multi-frame environment, Aperture can observe:

- which frames attract immediate action
- which frames are tolerated as ambient
- which frames should likely be grouped
- which frames consistently fail to justify interruption

This is one of the strongest arguments for Aperture as an interaction intelligence layer rather than a simple HITL surface.

## Product Implication

This expands the Aperture product from:

- a system that emits `Frame`s

to:

- a system that emits `Frame`s
- observes interaction signals around them
- learns from explicit and implicit human behavior
- improves future interaction judgment

## Future Architecture Implication

This should remain small. The current design does not need new public constructs yet.

The current implementation keeps this tight:

- raw interaction signals stay simple
- richer states are derived internally
- compact trends are derived internally from repeated signal patterns
- the judgment coordinator uses those derived states only for bounded scoring and suppression decisions
- learning what context is or is not useful
- informing future coordination decisions

### Anticipation Engine

A future advisory layer that uses learned patterns to suggest:

- what should be staged next
- what context should be gathered in advance
- what should be suppressed
- what should be grouped
- what the human is likely to want next

## Flywheel

This creates the long-term Aperture flywheel:

1. events enter Aperture
2. Aperture emits frames
3. humans respond explicitly and implicitly
4. Aperture captures interaction signals
5. reasoning improves
6. coordination improves
7. anticipation improves
8. future frames become better timed, better shaped, and better prioritized

That is the long-term learning loop.

## Guardrails

This vision only works if it is disciplined.

Important constraints:

- do not treat every behavioral trace as equally meaningful
- do not hide consequential decisions behind opaque learned behavior
- keep high-risk flows legible and policy-bounded
- make signal use explainable wherever possible
- respect privacy and data minimization principles

## Product Language

This concept can be described externally as:

- Aperture learns from how humans respond to interactions
- Aperture learns from attention, not just answers
- Aperture improves by observing response patterns, latency, omission, and prioritization

The strongest concise formulation is:

**Aperture learns not only from what humans say yes or no to, but from how their attention moves across possible interactions.**
