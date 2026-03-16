# Engine Architecture Evaluation

## Question

Is Aperture's deterministic judgment engine still the right core architecture for the product?

## Short Answer

Yes, the deterministic engine is still the right hot-path architecture.

The current fragility is not a sign that the core product should move to an LLM-decided or probabilistic routing path. It is a sign that the semantic inputs feeding the deterministic engine have been too heuristic in a few routing-critical seams.

The right move is:

1. keep the deterministic judgment engine
2. reduce heuristic classification in policy-critical paths
3. push more explicit semantics into adapters
4. harden invariants, replay, and golden-scenario coverage

## Why The Deterministic Core Is Still Right

### 1. The product promise depends on consistency

Aperture is not a chat assistant. It is a judgment engine for human attention.

That means the engine needs to be:

- inspectable
- reproducible
- low-latency
- debuggable after the fact
- stable under replay

A deterministic engine gives us all five.

### 2. The engine already has the right shape

The current stack cleanly separates:

- evidence assembly
- policy gates
- utility scoring
- interrupt criterion
- routing
- continuity
- frame materialization

That layering is strong. The recent bugs were not proof that the hierarchy is wrong. They were proof that the semantic inputs entering that hierarchy were occasionally too loose.

### 3. Auditability is part of the moat

One of Aperture's strongest advantages is that it can explain:

- what was evaluated
- what fired
- what changed the route
- why the final decision won

An LLM-decided hot path would materially weaken that advantage unless it were wrapped in a heavy, expensive, and still-incomplete explanation layer.

### 4. The operator surface cannot tolerate model jitter

Attention surfaces lose trust quickly when identical or near-identical events route differently for opaque reasons.

The deterministic core minimizes that class of failure. It makes mistakes, but those mistakes are tractable and fixable.

## What Actually Felt Fragile

The recent failures clustered in a smaller set of seams:

- text-based tool-family inference
- configured policy matching from inferred tags
- continuity ordering interactions
- task-view/state-commit mismatches

In other words: the fragility was mostly in the *semantic classification layer* and *state commit layer*, not in the existence of deterministic policy/routing itself.

## What We Learned From The Recent Bugs

### 1. Text should not become semantics in routing-critical paths

The strongest example was passive status like `Read completed` being inferred as tool family `read`, then accidentally matching `lowRiskRead` configured policy.

That is not a failure of deterministic routing.

That is a failure to distinguish:

- display text
- semantic metadata

### 2. Deterministic systems need explicit contracts at the edges

If adapters know:

- which tool fired
- whether the event is passive vs blocking
- whether the event is a completion, question, approval, failure, or follow-up

then the core should receive that explicitly whenever possible.

The more the core has to infer from natural-language text, the more fragile the system becomes.

### 3. Route correctness and state correctness are separate

We also saw bugs where:

- the planner reached the right route
- but the committed task/global view still surfaced the wrong frame

That means confidence has to cover both:

- decision formation
- decision application

## Alternatives Considered

### Option A: Move judgment to an LLM hot path

Pros:

- richer semantic flexibility
- potentially better handling of novel edge cases

Cons:

- slower
- less reproducible
- harder to diff and replay
- harder to trust in operator-facing attention routing
- more expensive
- explanation quality becomes post-hoc instead of intrinsic

Verdict:

Not recommended for the hot path.

### Option B: Hybrid model where an LLM classifies semantics and the deterministic engine routes

Pros:

- better semantic enrichment for messy host inputs
- deterministic routing can remain intact

Cons:

- introduces a new reliability dependency
- semantic jitter still becomes a trust problem if used live
- increases complexity

Verdict:

Potentially useful later as:

- an offline replay/evaluation aid
- an optional advisory enrichment lane
- a debugging/comparison tool

Not recommended as a required live dependency for the main product path today.

### Option C: Keep deterministic routing, but tighten semantic inputs

Pros:

- preserves low-latency deterministic behavior
- directly targets the failures we actually saw
- improves adapter contracts
- strengthens replay, testing, and traceability

Cons:

- requires more discipline in adapters
- requires invariant and scenario coverage to stay healthy

Verdict:

Recommended.

## Recommendation

Keep the deterministic engine as the authoritative decision path.

But evolve the architecture in this direction:

### 1. Explicit semantics first

Adapters should explicitly provide whenever known:

- toolFamily
- risk hints
- whether the event is blocking vs passive
- whether it is approval, failure, completion, follow-up, or awareness

Core should treat natural-language inference as fallback-only, not as policy-critical truth.

### 2. Separate semantic enrichment from judgment

Conceptually, the pipeline should be:

- raw host event
- semantic normalization/enrichment
- deterministic judgment
- state commit
- surface rendering

Today some semantic enrichment still leaks into judgment-time heuristics. That boundary should get cleaner.

### 3. Introduce judgment invariants

Add permanent invariants like:

- passive status with `responseSpec.kind === "none"` must not match approval-oriented policy by loose wording alone
- explicit ambient/queue policy must remain peripheral even if scores drift upward
- same-interaction refresh must not bypass stronger suppressive continuity rules
- task/global view state must reflect the final routed bucket

### 4. Maintain golden scenarios across adapters

Each adapter should have named end-to-end scenarios such as:

- Claude `PostToolUse(Read)` completion -> ambient
- Claude `Stop` plain completion -> ambient
- Claude follow-up question -> blocked/active
- OpenCode passive completion -> ambient
- Codex approval request -> active approval

### 5. Build replay and shadow evaluation into normal development

Confidence should come from:

- traces
- replays
- scenario diffs
- invariant failures

not from intuition alone.

## Near-Term Engineering Plan

### Now

- continue explicit metadata threading from adapters into `task.updated` / passive status paths
- reduce policy-critical dependence on text inference
- add classification invariants

### Next

- audit other adapters for missing explicit semantics
- split "explicit tool family" and "inferred tool family" usage everywhere
- move more continuity/stream identity logic onto explicit metadata

### Later

- build replay/scorecard tooling for judgment changes
- consider optional LLM-assisted semantic analysis in offline evaluation
- do not move live attention routing to the model path unless deterministic guarantees can be preserved

## Final Call

The deterministic engine is still the right core product architecture.

The current work should make it *more deterministic at the edges*, not less.

The real architectural lesson is:

- keep the judgment core deterministic
- make semantics more explicit
- make evaluation more systematic

That is the path that improves both trust and product quality without giving up the advantages that make Aperture distinct.
