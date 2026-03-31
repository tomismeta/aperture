# Aperture Cloud

## The Short Version

**Aperture Cloud is the human judgment API for autonomous agents.**

Agents increasingly do real work on their own, but they still hit moments where
they need human judgment:

- approve this action
- choose between these options
- handle this exception
- resolve this ambiguity
- make a judgment call with consequences

Today, that usually means interrupting the wrong person, with too much context,
at the wrong time.

Aperture Cloud turns that into infrastructure.

An agent invokes Aperture Cloud when it needs a human decision. Aperture
decides whether a human is actually required, packages the minimum useful
context, routes the request to the right human or pool, captures the response,
and returns a typed result to the agent.

## Thesis

Aperture should be understood as a three-product family:

1. **Aperture Local**
   - the calm local attention surface for coding agents
2. **Aperture SDK**
   - the embeddable deterministic judgment layer
3. **Aperture Cloud**
   - the routed human judgment network for autonomous systems

The core thesis of Aperture Cloud is:

- autonomous systems will make human judgment more scarce, not less valuable
- the bottleneck will increasingly be access to the right human decision at the
  right time
- the winning infrastructure layer will not just "show notifications"
- it will decide when a human is needed, who should answer, what context they
  should see, and how the decision should return to the agent

That makes Aperture Cloud:

- a human judgment API for agents
- a trusted escalation layer
- a judgment switchboard between agents and humans

## What Aperture Cloud Is

Aperture Cloud is:

- a routing layer for human-required agent decisions
- a policy layer for what can be shown, to whom, and when
- a responder network with trust, qualification, and calibration
- a structured inbox for humans answering narrow agent requests
- an audit and replay system for improving judgment quality over time

Aperture Cloud is not:

- a generic agent framework
- a generic workflow builder
- a generic approval bot
- a random marketplace of low-context microtasks
- a hidden remote semantic classifier in the hot path

## Product Architecture

The architecture should remain hybrid.

The deterministic judgment hot path should stay local or customer-controlled.
Cloud should own routing, policy, identity, calibration, and remote surfaces.

```text
agent host / adapter
-> local or edge Aperture runtime
-> deterministic Aperture core
-> local decision:
   - interrupt local operator
   - queue
   - ambient
   - suppress
   - escalate to cloud
-> if escalated:
   Aperture Cloud Dispatch
   -> identity, availability, qualification, and policy
   -> human inbox web / mobile / desktop
   -> responder scoring and calibration
   -> structured decision response
-> response returned to runtime
-> typed action returned to the agent
-> trace, capture, replay, and calibration flow into Aperture Lab
```

### Core Components

1. **Aperture Runtime**
   - local or edge host
   - owns adapter attachment and return path
   - preserves deterministic judgment locally

2. **Aperture Core**
   - deterministic judgment engine
   - decides whether human attention is actually needed
   - remains the authoritative hot path

3. **Aperture Cloud Dispatch**
   - cloud router for human-required work
   - chooses the right human or qualified pool
   - enforces policy, SLAs, and escalation rules

4. **Aperture Inbox**
   - web, mobile, and desktop response surfaces
   - presents bounded decisions with minimum useful context

5. **Aperture Policy**
   - defines who can answer what
   - defines what data may leave the local environment
   - defines when work stays local, team-internal, or network-routed

6. **Responder Calibration**
   - measures responder quality, speed, consistency, and reversal rates
   - informs routing and trust over time

7. **Aperture Lab**
   - replay, review, calibration, and regression control
   - improves not just local judgment, but cloud routing and context packaging

## The API Concept

Philosophically, Aperture Cloud should be treated as a human judgment API.

Agents invoke it when they need:

- approval
- structured choice
- exception handling
- ambiguity resolution
- escalation to a more trusted human

The contract should stay narrow and typed.

Conceptually:

- request:
  - "a decision is needed"
- routing:
  - "who should answer?"
- response:
  - "here is the structured human judgment"

That is a much stronger product identity than:

- inbox product
- marketplace
- approval UI

## Why Now

The broader trend is moving toward:

- more autonomous coding agents
- more asynchronous/background agents
- more cloud-hosted agent work
- more parallel agent activity per human

As that happens, the bottleneck stops being generation and becomes:

- access to human judgment

The more abundant agents become, the more valuable well-routed human judgment
becomes.

## Product-Market Fit Hypothesis

Aperture Cloud does not have product-market fit today.

The PMF hypothesis is:

- teams and solo builders using agents heavily will hit judgment bottlenecks
  before they hit pure model-quality bottlenecks
- many of those users will not have the right second operator available at the
  right time
- they will pay for faster access to narrow, high-quality human judgment if it
  is:
  - structured
  - low-friction
  - policy-safe
  - auditable

## Wedge

The first wedge is not "all enterprises."

The first wedge is:

- solo developers and small teams already using coding agents heavily
- people who need a second human judgment layer but do not have one readily
  available
- early adopters willing to trade some novelty risk for faster throughput

The product promise is:

- "Your agents can get human judgment on demand without stalling your workflow."

That is much more legible than selling:

- attention doctrine
- control planes
- semantic normalization

If that wedge works, Aperture Cloud can move up-market into:

- team pools
- enterprise internal judgment routing
- vetted expert networks

## Moat

If Aperture Cloud works, the moat expands beyond the local engine.

### 1. Deterministic judgment

- local hot-path trust and replayability

### 2. Cross-agent normalization

- one bounded escalation language across many agent hosts

### 3. Context packaging

- the right human sees the minimum useful context, not the whole transcript

### 4. Trust and qualification routing

- who is good at which decision classes
- who is fast, careful, and reliable
- what should never leave a local or org boundary

### 5. Responder calibration

- who is overturned often
- who gives high-signal decisions
- which humans should receive more or less traffic over time

### 6. Replay and calibration

- Aperture Lab improves both local judgment and cloud routing quality

### 7. Network effects

- over time, the system learns which humans, teams, and expert pools are best
  for which judgment requests

## Business Shape

If Aperture Cloud is real, the business model is more obvious than the local
product alone.

Possible shapes:

- usage-based pricing per escalated judgment request
- subscription plus included decision volume
- premium routing tiers for trusted pools or domain specialists
- enterprise pricing for internal-only judgment routing, policy, and audit

The public product should create demand.
The enterprise product should deepen trust and spend.

## Risks

This is a high-risk product line.

### 1. Dystopian marketplace drift

If this becomes "random humans for agent leftovers," it collapses into low-trust
piecework.

### 2. Trust failure

If users do not believe the routing, privacy, and accountability are strong,
the category never forms.

### 3. Poor responder quality

If the system routes to low-quality humans, the entire thesis breaks.

### 4. Platform compression

Host platforms may ship weaker native versions of this and shrink the wedge.

### 5. Timing risk

The market may not be ready yet, even if the product is conceptually right.

## Guardrails

If Aperture Cloud is pursued, these rules should stay fixed:

1. the hot-path judgment remains deterministic
2. cloud does not become a hidden semantic brain
3. context is minimized and policy-bound
4. responder quality is measured by outcomes, not just speed
5. auditability is first-class
6. the product is framed as trusted judgment infrastructure, not labor
   arbitrage

## Rollout Sequence

### Phase 1: Internal and trusted routing

- route to known teammates and trusted pools first
- prove the routing and context packaging model

### Phase 2: Public early-access network

- let solo builders and small teams access trusted human judgment on demand
- narrow request types
- high instrumentation and strong quality control

### Phase 3: Enterprise policy and internal pools

- internal-only routing
- org policy
- audit and qualification controls

### Phase 4: Expert networks

- vetted specialists for specific domains
- stronger trust, pricing, and SLA layers

## The One-Sentence Pitch

**Aperture Cloud is the human judgment API for autonomous agents.**

It gives agents a safe, structured, and calibrated way to ask humans for the
decisions that still matter.
