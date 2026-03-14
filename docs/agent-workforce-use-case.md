# Agent Workforce Use Case

## Purpose

This document narrows Aperture to the first use case that currently feels concrete enough to test:

**one human supervising many coding agents and subagents across CLI-heavy workflows**

This is not a generic "agent UI" story.

It is a specific operator problem:

- many agents are running at once
- many of them can interrupt
- the human cannot context-switch cleanly across all of them
- terminal and web surfaces both matter
- not every event deserves the same level of attention

## Why This Use Case Is Better

This use case is stronger than a general agent-app integration story because it already has the conditions Aperture needs.

### 1. There Are Many Concurrent Producers

Examples:

- Codex coding agents
- Claude Code sessions
- OpenClaw / ACT agent workers
- subagents spawned from larger jobs
- supporting automation and diagnostics processes

This is immediately different from a single chat agent.

### 2. Human Attention Is The Bottleneck

The hard problem is not raw event transport.

The hard problem is:

- which interrupt deserves attention now
- which one can wait
- which ones belong together
- which one should stay ambient

Or more simply:

- how human attention should be spent across many active agents

That is Aperture's actual wedge.

### 3. The Workflow Is Already Cross-Surface

In these environments, the human often moves between:

- terminal
- editor
- local browser
- dashboards
- notifications

That makes cross-surface interaction semantics more valuable than in a purely in-app copilot flow.

### 4. The Cost Of Bad Coordination Is Real

If coordination is poor:

- important review requests get buried
- humans approve without enough context
- low-value noise steals focus from blocking work
- agent fleets feel chaotic rather than productive

This is a much sharper pain than "we want dynamic UI for agents."

## Target Operator

The first operator to design for is:

**a developer or technical operator supervising multiple coding agents and subagents working in parallel**

They are not asking for:

- a better chat window
- a general observability dashboard
- another protocol

They need:

- one place to understand what deserves action now
- bounded interaction surfaces for approvals, reviews, and exceptions
- less context switching across many simultaneous agent threads

## Candidate Sources

The first ingress sources worth targeting are:

- `Codex`
- `Claude Code`
- `OpenClaw` / ACT worker agents

These should be treated as event producers, not as the place where Aperture's semantics live.

That means each source should have an ingress adapter or plugin that maps source-native events into `SourceEvent`, which `@aperture/core` then normalizes semantically.

## Plugin / Adapter Implication

If this is the primary use case, Aperture likely needs source-specific collection adapters.

### Likely First Adapters

- `@aperture/openclaw`
- `@aperture/codex`
- `@aperture/claude-code`

The job of these adapters is:

- observe source-native events
- shape them into `SourceEvent`
- preserve source identity and provenance
- pass them into `Aperture Core`

They should not:

- redefine Aperture semantics
- become transport standards
- own host-side rendering

## What Should Be Emitted

Aperture should not ingest every log line or trace event.

The adapter should emit only events that can influence human attention meaningfully.

Good event categories:

- approval required
- plan review requested
- diff review requested
- blocked on missing input
- conflict between candidate actions
- exception needing adjudication
- completion with optional follow-up
- ambient status worth tracking but not surfacing prominently

Bad event categories:

- raw token streaming
- every tool call
- unfiltered logs
- implementation-level traces with no human consequence

## Current Interrupt Types

The current core supports these `AttentionFrame` modes:

- `approval`
  - approve a plan
  - approve an execution step
  - approve a deploy or file operation

- `choice`
  - choose between candidate strategies
  - select one of several generated plans
  - pick a rollback or recovery path

- `form`
  - fill missing configuration
  - provide credentials or bounded operator input
  - resolve structured ambiguity

- `status`
  - track long-running work without turning it into interruption
  - surface blocked or failed work without turning every update into a prompt

## Why Aperture Might Actually Win Here

In this use case, Aperture is not competing to be:

- the agent runtime
- the coding environment
- the renderer
- the protocol

It is competing to do one thing well:

**turn many simultaneous coding-agent events into the right bounded human interactions at the right time**

That is more defensible here than in a general-purpose app context because:

- the workflows are naturally multi-source
- the operator already experiences overload
- CLI support is first-class, not a side case
- app teams are less likely to want to hand-build a coordination layer for every internal agent workforce

## Validation Test

This use case is worth pursuing only if Aperture can beat direct event handling in a way that feels obvious.

The first proof should be:

- multiple Codex / Claude Code / OpenClaw sources
- one shared `AttentionView`
- one human operator
- fewer context switches
- clearer priority ordering
- less manual triage

If Aperture does not make that workflow feel calmer and more legible quickly, the wedge is not real enough.

## Immediate Product Direction

If Aperture pursues this path, the next product questions become:

1. What are the first 5-7 interrupt types for coding-agent supervision?
2. What source metadata must be preserved from Codex, Claude Code, and OpenClaw?
3. What does a useful CLI-first `AttentionView` look like for an operator?
4. What should remain ambient versus interruptive by default?
5. Which source adapter should be built first?

## Recommendation

Treat this as the first serious candidate for product-market validation:

**Aperture as the attention layer for agent workforces, especially coding-agent workforces.**

That is narrower, more testable, and more defensible than "human-in-the-loop agent workflows" in general.
