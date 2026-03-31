# Aperture Cloud (Exploration Note)

## Status

This note preserves a possible future product direction.

It is **not** the current Aperture roadmap.

The active product focus remains:

1. **Aperture Local**
   - the calm local attention surface for coding agents
2. **Aperture SDK**
   - the embeddable deterministic judgment layer

This document exists so we do not lose the architectural and product thinking
around a possible cloud line before there is enough real user pull to justify
it.

## The Short Version

If Aperture ever grows into a cloud offering, the cleanest version is:

- agents invoke Aperture when they need human judgment
- Aperture decides whether a human is actually required
- Aperture routes the request to the right human or trusted pool
- Aperture returns a typed human decision to the agent

That would make Aperture Cloud:

- a human judgment API for agents
- a trusted escalation layer
- a routing and policy layer for human-required decisions

But that is still a speculative future product line, not something Aperture is
actively pursuing right now.

## Why Preserve The Option

Even without building Aperture Cloud now, it is worth preserving the option.

The current architecture already has some of the right primitives:

- bounded source events
- deterministic local judgment
- typed human response paths
- provenance, impact, and auditability
- local replay and calibration

Those are useful today for the local product, and they also keep a future cloud
route possible without forcing us to build toward it prematurely.

## The Product Split

If this is revisited later, it should be treated as two different products, not
one blurred idea.

### Aperture Teams

Internal routing among known humans:

- an agent asks for a decision
- Aperture routes it to the right teammate or internal on-call human
- the request stays inside the team or org boundary

This is the more plausible near-term cloud direction.

### Aperture Network

External routing to trusted responders outside the immediate team:

- an agent asks for a decision
- Aperture routes it to a qualified external responder or expert pool
- the request requires much stronger privacy, trust, quality, and economic
  controls

This is the bigger bet, but also the much riskier and less proven one.

If Aperture ever revisits cloud seriously, it should be possible to build
`Teams` and never build `Network`.

## A Possible Product Thesis

If autonomous systems become more capable and more parallel, the remaining
bottleneck may become access to human judgment:

- approvals
- exception handling
- ambiguity resolution
- policy-bound decisions
- narrow, high-leverage judgment calls

If that happens, a useful Aperture Cloud could become:

- the infrastructure through which agents ask for human judgment
- the routing layer that decides who should answer
- the policy layer that decides what context may be shown
- the audit layer that records what happened and why

Again, this is a possible future thesis, not the current product commitment.

## Architecture Boundary

If Aperture Cloud is ever pursued, the architecture should stay hybrid.

The deterministic hot path should remain local or customer-controlled.
Cloud should own routing, identity, policy, remote inboxes, and audit.

```text
agent host / adapter
-> local or edge Aperture runtime
-> deterministic Aperture core
-> local decision:
   - interrupt local operator
   - queue
   - ambient
   - suppress
   - escalate
-> if escalated:
   Aperture Cloud Dispatch
   -> identity, availability, qualification, and policy
   -> human inbox web / mobile / desktop
   -> structured decision response
-> response returned to runtime
-> typed action returned to the agent
-> trace, capture, replay, and calibration flow into Aperture Lab
```

### Durable Components

1. **Aperture Runtime**
   - local or edge host
   - owns adapter attachment and return path

2. **Aperture Core**
   - deterministic judgment engine
   - decides whether human attention is needed

3. **Aperture Cloud Dispatch**
   - cloud routing for human-required work
   - chooses the right human or internal pool

4. **Aperture Inbox**
   - human response surface
   - presents bounded decisions with minimum useful context

5. **Aperture Policy**
   - defines who can answer what
   - defines what data may leave the local environment
   - defines when work stays local, team-internal, or network-routed

6. **Aperture Lab**
   - replay, review, calibration, and regression control
   - improves judgment, routing, and context packaging over time

## API Optionality

If a cloud product is ever built, the first API should stay narrow and should
reuse Aperture's existing contracts instead of inventing a new abstract
platform.

The most natural shape would be:

- input: a bounded human-input request from the existing event model
- routing: Aperture decides whether and where it should go
- output: a typed `AttentionResponse`

In other words:

- do not start with a generic workflow engine
- do not start with freeform question routing
- do not start with a giant marketplace abstraction

Start with the same narrow human-invocation contract Aperture already uses
locally.

## What Would Need To Be Proven

Before this becomes a real product direction, several questions would need
clear answers.

### 1. Why This Beats Local-Only Workflows

Why is this meaningfully better than:

- local Aperture only
- Slack
- email
- ticketing
- existing approval tools

The answer cannot just be "human judgment API." It would need to show clear
value in:

- routing quality
- context packaging
- typed responses
- auditability
- policy enforcement

### 2. Privacy And Data Boundaries

What context can leave the local environment?

- none
- redacted context only
- team-internal only
- limited external trusted pools

This is an architectural constraint, not a later legal detail.

### 3. Unit Economics

If external humans are ever involved:

- what does a judgment request cost?
- what is the latency target?
- who gets paid?
- how is quality measured?

Without plausible unit economics, `Aperture Network` should remain a thought
experiment.

### 4. Quality And Trust

How do we know the human response quality is high enough to justify routing
there at all?

This would require:

- qualification
- calibration
- reversals and outcome tracking
- strong audit trails

### 5. Real User Pull

The cloud idea should only become active if real usage of Aperture Local shows:

- repeated demand for remote or team-routed human decisions
- clear pain around internal escalation
- users asking for second-opinion or off-device judgment help

Until then, it should remain optionality, not roadmap gravity.

## Guardrails

If this direction is ever revisited, these rules should stay fixed:

1. the hot-path judgment remains deterministic
2. cloud does not become a hidden semantic brain
3. context is minimized and policy-bound
4. auditability is first-class
5. `Aperture Teams` and `Aperture Network` are treated as different products
6. the product is framed as trusted judgment infrastructure, not labor
   arbitrage

## What This Means Right Now

Right now, this note should be read as:

- a preserved future option
- an architectural boundary check
- a product thought exercise

It should **not** be read as:

- the current company thesis
- the current go-to-market motion
- the next active build plan

## The One-Sentence Version

If Aperture ever expands into cloud, the strongest version is a trusted human
judgment layer for agent systems. For now, that remains a future option rather
than an active product commitment.
