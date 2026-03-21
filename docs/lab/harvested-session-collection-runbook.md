# Harvested Session Collection Runbook

This runbook defines the first five real-session collection targets for
Aperture Lab.

The goal is not to collect random traffic.

The goal is to collect a small, useful corpus that pressures the current
semantic contract, ambiguity handling, continuity logic, and explanation layer
before any `ApertureCore` decomposition work.

## Main Rule

Each recorded session should be:

- short
- intentional
- locally reviewable
- centered on one main doctrine question

Prefer one focused session per doctrine question over one giant mixed session.

## Recording Loop

From [/Users/tom/dev/aperture](/Users/tom/dev/aperture):

1. Start the live stack:

```bash
pnpm aperture
```

2. In another terminal, begin recording:

```bash
pnpm session:record --title "approval escalation" --tag harvested --tag approval
```

3. Exercise the specific flow.
4. Press Enter in the recorder terminal to export the bundle.
5. Review the resulting bundle under
   [packages/lab/bundles](/Users/tom/dev/aperture/packages/lab/bundles).

Recommended naming:

- `--title` should say what the doctrine question is
- `--tag harvested` should always be included
- add one or two narrow tags such as:
  - `approval`
  - `failure`
  - `continuity`
  - `ambient-noise`
  - `ambiguity`

## Target 1: Dangerous Approval Flow

**Purpose**

Pressure-test high-consequence approval semantics on real source traffic.

**Prompt shape**

- ask an agent to propose a risky or production-adjacent action
- require it to ask for approval before execution
- do not let it actually execute the action

Examples:

- clear a production cache
- run a destructive filesystem command
- apply a risky deployment or rollback command

**What to observe**

- did the event surface as active or clearly queue-worthy?
- did the consequence feel correct?
- did `whyNow` tell the truth?
- did it over-index on scary wording without real action?

**Best outcome**

- one compact approval session with 1-3 turns
- ideally includes the eventual acknowledge or decision response

## Target 2: Benign Read Or Search Flow

**Purpose**

Verify that read-like or inspection-like work stays low consequence even when
the wording contains scary context like `production`.

**Prompt shape**

- ask the agent to inspect, read, summarize, or search
- mention production or another high-salience environment in a non-destructive
  way

Examples:

- inspect a production runbook
- search deployment logs
- summarize a config file related to production

**What to observe**

- did the engine avoid overreacting?
- did the work stay peripheral or at least non-critical?
- did the explanation avoid false danger language?

**Best outcome**

- one short session with no actual approval or blocking requirement

## Target 3: Ambiguous Failure Or Waiting Flow

**Purpose**

Pressure-test low-confidence and abstention handling on messy status language.

**Prompt shape**

- ask the agent to report a failure or waiting condition in language that is
  somewhat vague, hedged, or partial
- avoid making it an explicit operator request

Examples:

- “build may have failed”
- “waiting on approval before continuing”
- “this might need attention”

**What to observe**

- did the engine queue or ambient the work instead of pretending certainty?
- did ambiguity appear in the trace/decision path?
- did it later recover correctly when stronger evidence arrived?

**Best outcome**

- one session with:
  - an ambiguous first event
  - a stronger follow-up event that clarifies the outcome

## Target 4: Repeated-Issue Continuity Flow

**Purpose**

Pressure-test `same_issue`, `repeats`, and wording-drift continuity logic.

**Prompt shape**

- create repeated updates about the same underlying problem
- vary the wording across updates
- keep the anchor stable enough that a human would obviously see it as one issue

Examples:

- failing build -> retry failed -> same branch still broken
- blocked migration -> retry still blocked -> blocker persists

**What to observe**

- did the engine bundle the updates into one episode instead of fragmenting?
- did recurring evidence strengthen the right frame?
- did it avoid spawning noisy duplicate queued items?

**Best outcome**

- one 3-5 step session around the same underlying issue

## Target 5: Resolution Or Supersede Flow

**Purpose**

Pressure-test `resolves` and `supersedes` behavior on real continuity.

**Prompt shape**

- start with one active or queue-worthy issue
- follow it with either:
  - a clear resolution
  - a newer step that supersedes the previous one

Examples:

- deploy approval -> rollback supersedes deploy
- blocked issue -> fix landed -> resolved
- old plan replaced by a better recovery step

**What to observe**

- did the engine clear or advance the episode correctly?
- did the active/queued state move to the right new step?
- did it avoid leaving stale frames visible too long?

**Best outcome**

- one session where the continuity outcome is obvious to a human

## What To Record Alongside Each Bundle

For each recorded bundle, keep a short note with:

- what host path was used
  - `runtime`
  - `claude`
  - `opencode`
  - `paperclip`
- what doctrine question it was testing
- what felt wrong, if anything
- whether it should become:
  - a golden scenario
  - a fuzz seed
  - a continuity regression
  - a doctrine update

## Promotion Criteria

Promote a harvested session into a first-class Lab asset if:

- the failure mode is likely to recur
- the bundle is short enough to understand
- the underlying doctrine lesson is clear
- the case is better than an authored synthetic version

## Exit Criteria For The First Collection Pass

The first harvested pass is successful when:

- at least one bundle exists for each of the five targets above
- at least three bundles are worth slicing into smaller replay episodes
- at least one new golden scenario is created from harvested reality
- we learn at least one real doctrine or boundary correction from the corpus
