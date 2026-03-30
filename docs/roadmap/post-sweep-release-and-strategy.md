# Post-Sweep Release And Strategy

This note captures the immediate next moves after the current pre-release
F-Stop sweep, along with the clearest strategic read on where Aperture should
go next.

Read this alongside:

- [Engine Roadmap](./engine-roadmap.md)
- [Technical Product Roadmap](./technical-product-roadmap.md)
- [F-Stop Architecture](../lab/fstop-architecture.md)

## Purpose

This note answers four practical questions:

1. what we should do immediately after the current sweep finishes
2. where the product wedge is actually working now
3. where the moat is already deepening
4. what we are still not doing that we probably should be

## Immediate Sequence

The next shipping sequence should stay tight:

1. finish the current pre-release F-Stop sweep
   - `swe-smith/xml`
   - `open-agent-sessions/approved`

2. inspect only the highest-signal findings
   - merge real core-worthy semantic improvements
   - ignore brittle or corpus-shaped optimizer patches

3. cut the next package releases
   - `@tomismeta/aperture-core`
   - `@tomismeta/aperture`

4. keep the release story honest
   - document what the sweep covered
   - document what was unchanged
   - do not imply mathematical proof from reviewer agreement

The release bar should be:

- unattended sweeps ran reliably
- no new trustworthy core regressions surfaced
- any merged semantic changes are bounded, structural, and well-tested

## What The Sweep Is Buying Us

The current F-Stop loop is proving something important:

- Aperture Core can stay deterministic
- agent review can stay outside the hot path
- unattended long runs can now complete reliably
- repeated disagreements can be surfaced before a release instead of after it

That makes F-Stop strategically useful even when a sweep ends in `no_proposal`.

The value is not only "did we get a patch?"

It is also:

- "did the system stay stable under unattended pressure?"
- "did the reviewer repeatedly disagree on something important?"
- "did the optimizer try anything credible?"
- "did we prove the current cut is calm enough to ship?"

## The Wedge

The wedge is getting clearer.

Aperture should not position itself as:

- another coding agent
- another agent runtime
- another eval dashboard
- another approval API

The wedge should be:

- the judgment and attention layer for agent work

In plain language:

- existing agents generate and execute
- Aperture decides what deserves operator attention, when, and in what form

The product promise should sound like:

- connect your agents
- get one calm place for approvals, blocked work, failures, and meaningful
  follow-ups
- trust that the judgment layer is deterministic, inspectable, and improving

## The Moat We Already Have

The current moat is not model weights.

It is system architecture:

1. **Deterministic hot-path judgment**
   - real routing stays inside `aperture-core`
   - no model call is required to decide whether to activate, queue, or keep
     work ambient

2. **Cross-source normalization**
   - multiple hosts can collapse into one bounded event language
   - this is what lets operator behavior compound across adapters

3. **Replay and calibration**
   - real sessions can be replayed through real Core code
   - disagreements can be reviewed offline and turned into bounded fixes

4. **Inspectable explanation**
   - provenance and impact make judgments auditable
   - this matters for both user trust and lab iteration speed

5. **Local-first memory**
   - operator behavior, response patterns, and calibration can compound over
     time without moving intelligence into an opaque hosted control plane

## Moats We Are Not Yet Exploiting Enough

These are the most interesting moat-deepening moves that are still mostly open.

### 1. Operator Modeling As A First-Class Asset

Right now Aperture learns some operator behavior, but it still thinks mostly in
terms of event semantics plus bounded memory.

We should probably make the operator model much more explicit:

- interrupt tolerance
- response latency patterns
- approval strictness
- preferred escalation shape
- preferred batching behavior
- tolerance for ambiguous work

This should stay deterministic in the hot path, but the learned profile itself
could become one of the strongest product moats.

This is stronger than generic "personalization" because it changes the shape of
attention judgment, not just wording.

### 2. Anticipation Before Interruption

Right now Aperture is strongest at:

- filtering
- queueing
- explaining

It is still earlier at:

- anticipating that an interrupt will likely be needed soon
- preparing the operator before the agent stalls
- recognizing when the right move is "wait for one more correlated signal"

That anticipation layer is a real moat candidate because it turns Aperture from
reactive triage into proactive attention shaping.

Examples:

- likely approval needed soon
- likely clarification needed soon
- likely blocked branch of work forming
- likely duplicate interrupt burst that should be merged before surfacing

### 3. Autonomy Envelopes

One of the strongest missing product ideas is a more explicit autonomy ladder.

Not just:

- `allowed`
- `blocked`

But something closer to:

- safe to continue silently
- safe to continue but summarize later
- safe to continue until a risk threshold changes
- must stop for operator review now

This would let Aperture become the layer that defines how much autonomy a given
agent gets in a given context, per operator or per team.

That is much more defensible than just routing approval prompts.

### 4. Team-Level Attention Policy

Aperture is currently strongest as a local operator product.

A major moat extension would be making it the place where a team's attention
policy becomes real:

- which risks always interrupt
- which workflows can auto-continue
- which agents are trusted for which kinds of work
- how approvals should escalate across people or roles

That is not just "enterprise controls."

It is shared operational judgment for multi-agent teams.

### 5. Shadow Mode And Certification

F-Stop is currently helping us improve Aperture.

A bigger strategic move would be using the same machinery to evaluate agent
systems more broadly.

Examples:

- shadow-review a live agent stream without controlling it
- score how often an agent would have interrupted too early or too late
- certify a configuration as safe for a given autonomy envelope
- compare operator burden across hosts and settings

That creates a wedge into buyer conversations that already understand evals but
do not yet have an answer for operator burden.

### 6. Cross-Agent Continuity

Most systems still think one agent at a time.

Aperture should keep leaning into:

- multi-agent continuity
- cross-agent episode grouping
- shared operator attention budgets
- preserving the meaning of work across different agent surfaces

That matters more as the market shifts toward background agents, cloud agents,
and mixed local/remote workflows.

## What We Should Probably Not Do Yet

These are still attractive distractions:

- building an adapter zoo for its own sake
- becoming a generic eval platform
- becoming a generic agent orchestrator
- pushing models into the live judgment path
- widening the npm surface too quickly

The best bias now is:

- deepen the core
- keep a few live adapters healthy
- use F-Stop to improve judgment quality
- ship a cleaner operator experience

## Adapter Strategy

We should expand adapters selectively, not broadly.

The best next adapters are the ones that create either:

- meaningful new behavioral pressure on the judgment layer
- or a sharper market wedge

The most interesting current external signals are:

- OpenAI is clearly pushing Codex across CLI, IDE, web, automations, and
  integrations, which matters for Aperture's "judgment layer above many agent
  surfaces" story:
  [OpenAI Codex docs](https://developers.openai.com/api/docs/guides/code-generation)
- Anthropic is making Claude Code more programmable through the Agent SDK,
  which makes "Aperture around agent infrastructure" more plausible:
  [Claude Code overview](https://code.claude.com/docs/en/overview),
  [Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- Cursor is leaning harder into remote/cloud agents and self-hosted cloud-agent
  infrastructure, which makes cross-surface judgment more relevant:
  [Cursor Agent product page](https://cursor.com/product),
  [Cursor self-hosted cloud agents](https://cursor.com/blog/self-hosted-cloud-agents/)
- LangSmith and Braintrust continue to occupy observability/evals territory:
  [LangSmith platform](https://www.langchain.com/langsmith-platform),
  [Braintrust](https://www.braintrust.dev/)
- Cognition continues to frame the market around autonomous software
  engineering, which reinforces the need for a better operator boundary:
  [Cognition](https://cognition.ai/)

Recommended next-adapter bias:

1. keep Claude Code healthy
2. keep OpenCode healthy
3. strengthen Codex as the next meaningful third path
4. evaluate Cursor only if we want stronger cloud-agent pressure next

## The Most Important Core Work

The highest-value core work is still not breadth.

It is making the engine better at:

- understanding operator behavior
- adapting safely over time
- anticipating when human attention will be needed
- staying calm under ambiguity

That means the next core themes should be:

1. explicit operator profiles
2. stronger ambiguity handling
3. anticipation and pre-escalation
4. autonomy-envelope policy
5. richer replay-driven tuning

This is where the deepest moat compounds.

## A Simple Strategic Frame

The clean way to think about Aperture now is:

- agents generate and execute
- eval platforms measure outputs
- Aperture governs operator attention

That is the category we should keep building toward.

If that framing is right, then the product questions become:

- how do we become the default calm surface for agent work?
- how do we become the most trusted deterministic layer for human attention?
- how do we compound operator-specific judgment faster than host-native logic?

## Near-Term Recommendation

After the sweep finishes:

1. review the two remaining lanes carefully
2. merge only the most defensible core changes
3. publish the next `aperture-core` and `aperture` patch releases
4. keep F-Stop running as a standing pre-release and post-release habit
5. focus the next roadmap tranche on core anticipation and operator modeling

That is the tightest path that both ships the current work and deepens the
actual moat.
