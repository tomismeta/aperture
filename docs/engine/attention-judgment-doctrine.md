# Aperture Attention And Judgment Doctrine

This document defines Aperture's attention philosophy, the research evidence behind it, and the Aperture-native constructs that should turn that philosophy into a deterministic engine.

It is not a generic UX note.

It is the working doctrine for the flagship core.

## Purpose

Aperture should become the best deterministic attention-management system in the world for agent-heavy workflows.

That means:

- deciding what deserves human attention now
- deciding what should wait
- deciding what should stay ambient
- making the best possible use of human attention once it is spent

The key constraint matters just as much:

- do this without cameras, microphones, EEG, or opaque model calls in the hot path

The opportunity is not to invent a new science of attention.

The opportunity is to synthesize interruption science, alert-fatigue evidence, and decision psychology into a deterministic, inspectable, agent-native engine.

## Core Thesis

**Aperture protects your attention in a world designed to abuse it.**

In practical terms:

- interruption is expensive
- interruption meaning must be protected
- the engine should surface decisions, not raw events
- the engine should prefer stable, coherent judgment over twitchy local reprioritization

## What The Research Says

The literature points to a small set of stable truths:

- interruptions impose real switching and resumption costs
- interruption timing matters, especially task breakpoints
- low-quality alerts create alarm fatigue and destroy trust
- humans perceive urgency nonlinearly
- decision quality degrades under cumulative attention burden
- resumption cues matter after interruption
- experts perform well by filtering to decision-relevant cues, not by processing everything

## What That Means For Aperture

The research translates into a small set of engine requirements:

| Research truth | Aperture implication |
| --- | --- |
| Interruptions are costly | Interrupt rarely and only when justified |
| Breakpoints reduce interruption cost | Prefer queueing until better moments when possible |
| Alarm fatigue destroys trust | Protect the credibility of the interruptive channel |
| Urgency perception is nonlinear | Use perceptual tiers, not naive linear urgency encoding |
| Decision fatigue is cumulative | Raise interrupt thresholds under sustained burden |
| Experts use a few key cues | Surface the decision signal, not the source dump |
| Resumption is costly | Preserve context and restore the prior line of work |

## Aperture-Native Constructs

These are the core constructs Aperture should keep building around.

### 1. Attention worthiness

The engine's central question is:

- is the expected value of human action now greater than the expected cost of interrupting now?

### 2. Routing modes

The engine should treat these as first-class, not as fallback bins:

- `interrupt`
- `queue`
- `ambient`
- `suppress` or `reconcile`

### 3. Ambiguity

When the engine is not confident enough to interrupt, uncertainty should be explicit and should resolve conservatively.

### 4. Surface capabilities

The engine should know what the current attention surface can actually support and should never plan as if a surface can honor a response path that it cannot render.

### 5. Episode and pattern reasoning

The engine should reason over:

- single events
- streams of related events
- accumulated urgency
- continuity within a decision run

### 6. Behavioral feedback

The engine should learn from:

- response
- dismissal
- deferral
- non-response
- override
- return
- sequence

## Core Doctrines

### 1. Interruption credibility doctrine

Interruptive treatment is a scarce semantic resource.

The human should learn:

- when Aperture interrupts, it usually matters

Queue, ambient, and suppression exist partly to protect the meaning of interruption itself.

If Aperture repeatedly interrupts for weak, noisy, or non-actionable reasons, it trains the operator to discount the bell.

### 2. Decision-over-event doctrine

Aperture should surface the decision, not the raw event.

The human should not have to reconstruct meaning from source noise.

Every surfaced frame should lead with:

- what happened
- what is needed
- why now
- what the response paths are

### 3. Hard-gate interrupt doctrine

An item should not interrupt unless two hard gates are satisfied:

- it is actionable
- it is human-exclusive

Once those gates are true, interruptiveness should be shaped by weighted factors such as:

- time sensitivity
- consequence
- confidence
- poor fit for passive handling

### 4. Attention worthiness doctrine

The right doctrinal shape is:

```text
surface when:
  (value × time_sensitivity × actionability × confidence)
  > (interruption_cost × breakpoint_penalty × attention_burden)
```

This should not be treated as sacred literal math.

It is a structural guide.

It applies after the hard gates in the interrupt doctrine are satisfied.

In particular:

- actionability and human exclusivity are evaluated as hard gates before this scoring applies
- confidence is not a live hidden multiplier in the current engine
- today, low-confidence or abstained non-blocking semantics resolve through an explicit ambiguity lane into queue/ambient handling
- discriminability and criterion should remain conceptually separate

### 5. Perceptual urgency doctrine

Human urgency perception is not linear.

Aperture should encode urgency in perceptually meaningful tiers rather than in a flat linear ladder that compresses the top end and wastes resolution at the bottom.

### 6. Pattern accumulation doctrine

Individual low-urgency items can collectively become urgent.

Aperture should reason not only over single-signal urgency, but over aggregate urgency formed by:

- repetition
- clustering
- temporal density
- shared consequence
- episode growth

The engine should be able to say:

- this item is not urgent on its own
- this pattern is urgent now

### 7. Queue doctrine

Queueing is the correct answer when an item matters, but not enough to justify interrupting now.

That includes cases that are:

- actionable but not urgent
- meaningful but not dominant
- better handled at a task boundary
- part of a stream that should not yet steal focus

Queueing is not suppression.

It is deliberate deferred spending of attention.

### 8. Ambient doctrine

Ambient is correct when awareness is useful but foreground work is not.

Ambient exists for:

- informative but non-decision-requiring items
- low-consequence changes
- weakly actionable items
- already-known or low-novelty background state

### 9. Suppression doctrine

Aperture should suppress or reconcile:

- low-specificity warnings
- repeat noise
- status chatter without a decision need
- already-resolved or already-known conditions

The engine should preserve interruption trust by keeping interruption precision high.

### 10. Minimum dwell doctrine

Once Aperture gives the operator an active item, it should usually allow enough dwell time for the human to understand and act before switching to something only marginally stronger.

Immediate preemption should be reserved for clearly dominant, urgent, or safety-critical claims.

This is an Aperture thesis that should be validated empirically.

### 11. Decision-stream continuity doctrine

Aperture should prefer sustained progress through a coherent decision stream over constant reprioritization.

If the operator is already inside one:

- session
- workflow
- source stream
- or repeated class of decision

the engine should be reluctant to pull them away unless the new claimant is clearly better.

This is also an Aperture thesis that should be validated empirically.

### 12. Queue pressure doctrine

In a multi-agent system, queue depth is not neutral.

A growing backlog creates perceived urgency and stress even before any single item wins outright.

Queue state should influence judgment through:

- summaries
- grouped escalation
- pressure-aware promotion
- progressive disclosure

### 13. Surface capability degradation doctrine

If the ideal judgment path requires richer interaction than the current surface can support, Aperture should follow an explicit degradation policy.

Preferred order:

1. wait for a richer surface if delay is safe
2. degrade to a simpler but valid response path
3. surface clearly as blocked by surface limitations
4. suppress only when the interaction is neither safe nor useful on the current surface

### 14. Non-response doctrine

Non-response is a first-class judgment signal, not merely a timeout.

If a frame is seen and not acted on, Aperture should treat that as evidence about:

- timing
- overload
- ambiguity
- surface quality
- signal quality

Depending on frame class and consequence, non-response may justify:

- re-queueing
- demotion
- delayed re-presentation
- escalation
- learning that the frame was surfaced too aggressively

### 15. Conflicting interrupt doctrine

When two independently interrupt-worthy claims appear at the same time, the engine should resolve the conflict explicitly.

Default tiebreak order:

1. higher consequence
2. faster value decay
3. continuity with the current decision stream
4. stronger confidence

The losing interrupt should normally become the queue head or next most eligible claimant.

### 16. Resumption doctrine

The system that interrupts well but restores poorly is still a bad attention system.

After an interruptive frame resolves, Aperture should preserve or compute:

- prior active episode
- current decision target
- next recommended action
- context needed to resume
- time elapsed since displacement
- what was interrupted and why

This is not optional polish.

It is part of correct interruption handling.

### 17. Attention budget doctrine

Aperture should treat recent decision burden as part of current judgment.

The interrupt threshold should generally rise with cumulative decision load inside a working session.

That fatigue load should usually reset at natural boundaries such as:

- extended idle periods
- explicit breaks
- session restarts
- other strong evidence of cognitive reset

### 18. Absence doctrine

The operator is not always present.

Agents may continue producing attention-worthy events while the human is:

- away
- offline
- asleep
- or otherwise unreachable

During operator absence, Aperture should:

- continue judging and accumulating relevant state
- avoid applying active attention burden as if attention is being actively spent
- allow time-sensitive items to decay or expire if their value window closes
- preserve high-consequence items for reconnect or escalation
- batch and summarize on reconnect rather than replaying raw backlog mechanically

Out-of-band escalation, if it exists, should be reserved for explicitly high-consequence cases.

### 19. Source trust doctrine

Source trust should modulate the interrupt criterion.

High-trust sources should earn a lower bar for interruption.

Low-trust sources should face a higher bar.

This is the deterministic analogue of prior updating.

### 20. Operator override doctrine

Operator overrides are a first-class learning signal.

Examples:

- manually promoting a queued item
- quickly dismissing an interrupt
- repeatedly deferring one class of frame

These should inform future threshold and routing behavior.

### 21. Signal detection doctrine

The most useful formal lens for Aperture is signal detection theory.

In Aperture terms:

- discriminability = can the engine tell true attention-worthy signal from noise?
- criterion = where should the interrupt threshold sit?

The criterion should vary by:

- domain cost asymmetry
- operator tolerance
- workload posture
- source trust

Working model:

| Context | Miss cost | False alarm cost | Criterion |
| --- | --- | --- | --- |
| Safety-critical | Very high | Tolerable | More liberal |
| Balanced | Moderate | Moderate | Neutral |
| Deep-work protection | Tolerable | Very high | More conservative |

Loss framing also matters.

Signals framed as losses often feel more urgent than equivalent gain-framed signals.

For Aperture, that means:

- loss framing can increase perceived urgency
- dramatic loss framing from low-trust sources should increase skepticism, not credulity
- the engine should distinguish actual urgency from framing-driven urgency inflation

### 22. Timing doctrine

The best interrupt is often the one delayed to the right breakpoint.

Aperture should keep building toward:

- breakpoint-aware promotion
- dwell-aware replacement
- continuity-preserving queue ordering
- higher interrupt thresholds during likely deep work
- more permissive promotion at natural task boundaries

## Lessons From Elite Decision Domains

Aperture should borrow selectively from elite real-time decision environments such as:

- motorsport
- aviation
- emergency medicine
- other high-tempo expert coordination settings

The goal is not to imitate their rituals.

The goal is to extract transferable decision principles.

| Domain lesson | Aperture translation |
| --- | --- |
| Experts use a few high-value cues | bound frame context and reject source dumps |
| Experts stabilize after switching | minimum dwell and anti-thrash promotion |
| Expert teams clarify role and next action | every frame needs a clear primary response path |
| Expert systems use explicit interruption strategies | treat interrupt, queue, ambient, and suppress as deliberate modes |
| Experts escalate known dangerous patterns faster than novelty | weight pattern quality, consequence memory, and source trust |
| Experts preserve momentum inside one decision stream | continuity-aware switching and grouped handling |

## What A Surfaced Frame Must Contain

Once Aperture has the human's attention, the frame should answer:

1. **What happened?**
2. **What's needed?**
3. **Why now?**
4. **What are the options?**

This should guide frame construction mechanically:

- one primary action path
- tightly bounded option count
- clear ownership
- only the context required to decide safely

## What Not To Build

Aperture should not become:

- a sensor-heavy attention lab
- a general-purpose affect detector
- a UI widget catalog inside core
- a vague ML-based notifier

It should remain:

- deterministic
- inspectable
- source-agnostic at the core boundary
- grounded in behavioral evidence and explicit policy

## Doctrine-To-Engine Map

Current doctrine status:

| Doctrine | Status |
| --- | --- |
| Interrupt gate | Implemented |
| Queue routing | Implemented |
| Ambient routing | Implemented |
| Suppress or reconcile | Implemented |
| Ambiguity handling | Implemented |
| Surface capability awareness | Implemented |
| Trace visibility | Implemented |
| Generic text response path | Implemented |
| Absence handling | Partial |
| Pattern accumulation | Partial |
| Minimum dwell | Not yet |
| Decision-stream continuity | Not yet |
| Queue pressure surfacing | Not yet |
| Breakpoint-aware promotion | Not yet |
| Decision fatigue thresholding | Not yet |
| Resumption context restoration | Not yet |
| Surface capability degradation policy | Not yet |
| Non-response handling | Not yet |
| Simultaneous interrupt conflict resolution | Not yet |
| Source-trust thresholding | Partial |
| Operator-override learning | Partial |

## Build Priorities

The next doctrine-aligned work should be:

1. breakpoint and interruptibility modeling
2. minimum dwell and continuity-aware switching
3. non-response and override learning
4. resumption context restoration
5. pressure-aware queue surfacing
6. replay-based evaluation of policy changes

## Validation Priorities

Some parts of this doctrine are strongly supported already:

- interruption cost is real
- breakpoint timing matters
- alarm fatigue is real
- resumption support matters

Some parts are stronger Aperture theses that should be validated directly:

- minimum dwell improves decision quality and reduces thrash
- decision-stream continuity beats greedy global reprioritization in close calls
- queue pressure surfacing improves control without increasing overload

These should be tested with replay evaluation and live usage data.

## Research Refresh Workflow

If we rerun this research later, keep the same buckets:

### 1. Interruption science

Search themes:

- breakpoint interruption cost
- recovery from interruption
- resumption cues
- multitasking interruption recovery

### 2. Clinical alerting and alarm fatigue

Search themes:

- interruptive vs noninterruptive clinical decision support
- alarm fatigue systematic review
- passive decision support
- nonactionable alarms

### 3. Decision and cognitive psychology

Search themes:

- working memory limits
- choice reaction time
- signal detection theory decision threshold
- loss aversion framing
- psychophysical scaling of urgency

### 4. Agent-native attention systems

Search themes:

- alert triage for multi-agent systems
- deterministic attention allocation
- human-in-the-loop escalation policy

### 5. Evidence bar

Prefer, in order:

1. systematic reviews and meta-analyses
2. field studies and deployed systems
3. lab studies with clear behavioral measures
4. conceptual or computational papers

Avoid building doctrine from:

- marketing summaries
- productivity folklore
- purely sensor-driven systems that cannot transfer to software-native agent workflows

## Source Inventory

### Interruption timing and recovery

- Eric Horvitz, [Principles of Mixed-Initiative User Interfaces](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/chi99horvitz.pdf)
- Shamsi T. Iqbal and Brian P. Bailey, [Understanding and Developing Models for Detecting and Differentiating Breakpoints During Interactive Tasks](https://interruptions.net/literature/Iqbal_Bailey-CHI07.pdf)
- Shamsi T. Iqbal and Brian P. Bailey, [Effects of Intelligent Notification Management on Users and Their Tasks](https://interruptions.net/literature/Iqbal-CHI08.pdf)
- Erik M. Altmann and J. Gregory Trafton, [Timecourse of recovery from task interruption: data and a model](https://pubmed.ncbi.nlm.nih.gov/18229478/)
- Erik M. Altmann, J. Gregory Trafton, and David Z. Hambrick, [Momentary interruptions can derail the train of thought](https://pubmed.ncbi.nlm.nih.gov/23294345/)
- Jiale Li et al., [The effects of cues on task interruption recovery in a concurrent multitasking environment](https://pmc.ncbi.nlm.nih.gov/articles/PMC12271330/)

### Clinical alerting and alarm fatigue

- Bradford W. Winters et al., [Systematic review of physiologic monitor alarm characteristics and pragmatic interventions to reduce alarm frequency](https://pmc.ncbi.nlm.nih.gov/articles/PMC4778561/)
- Graham S. Funk et al., [Insights into the problem of alarm fatigue with physiologic monitor devices](https://pubmed.ncbi.nlm.nih.gov/25338067/)
- David W. Bates et al., [Clinical Decision Support: Moving Beyond Interruptive “Pop-Up” Alerts](https://pmc.ncbi.nlm.nih.gov/articles/PMC10491420/)
- Dustin T. Duncan et al., [Addressing Alert Fatigue by Replacing a Burdensome Interruptive Alert with Passive Clinical Decision Support](https://pmc.ncbi.nlm.nih.gov/articles/PMC10830237/)
- William M. Moxey et al., [Interruptive Versus Noninterruptive Clinical Decision Support: Usability Study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6492060/)
- Salena V. Bains et al., [The effectiveness of interruptive prescribing alerts in ambulatory CPOE to change prescriber behaviour and improve safety](https://pubmed.ncbi.nlm.nih.gov/33875570/)

### Cognitive and decision science

- John A. Swets, David M. Green, and John A. Swets, [Signal Detection Theory and Psychophysics](https://archive.org/details/signaldetectiont0000gree)
- Nelson Cowan, [The magical number 4 in short-term memory: a reconsideration of mental storage capacity](https://pubmed.ncbi.nlm.nih.gov/11515286/)
- W. E. Hick, [On the rate of gain of information](https://www2.psychology.uiowa.edu/faculty/mordkoff/InfoProc/pdfs/Hick%201952.pdf)
- Ray Hyman, [Stimulus information as a determinant of reaction time](https://www2.psychology.uiowa.edu/faculty/mordkoff/InfoProc/pdfs/Hyman%201953.pdf)
- Gustav Theodor Fechner, [Elements of Psychophysics](https://www.yorku.ca/~pclassic/Fechner/)
- Daniel Kahneman and Amos Tversky, [Prospect Theory: An Analysis of Decision under Risk](https://www.sfu.ca/~wainwrig/Econ400/PROSPECT THEORY.pdf)
- Roy F. Baumeister et al., [Ego depletion: Is the active self a limited resource?](https://pubmed.ncbi.nlm.nih.gov/12667037/)
- Philip L. Smith and Roger Ratcliff, [An integrated theory of attention and decision making in visual signal detection](https://pubmed.ncbi.nlm.nih.gov/19348543/)

### Elite decision domains and attention expertise

- Celine Stephan et al., [Mental Workload in F1 Sim-Racing Under Safety Car Conditions](https://www.frontiersin.org/journals/neuroergonomics/articles/10.3389/fnrgo.2026.1765659/full)
- Jason K. C. W. Lau et al., [Drivers’ cue utilization predicts cognitive resource consumption in a driving hazard perception task](https://pubmed.ncbi.nlm.nih.gov/31721607/)
- G. Sundstrom et al., [Crew Resource Management and non-technical skills training in healthcare: an umbrella review](https://pubmed.ncbi.nlm.nih.gov/34852415/)
- Sarah W. Loftus et al., [Interruption and task-switching strategies of emergency physicians](https://pubmed.ncbi.nlm.nih.gov/28601266/)
- Ryan J. H. D. Gong et al., [Task interruptions and task switching in emergency medicine: a scoping review](https://pubmed.ncbi.nlm.nih.gov/36378261/)

### Attention trends and modern context

- Mihaly Csikszentmihalyi, [Flow: The Psychology of Optimal Experience](https://archive.org/details/flowpsychologyof00csik)
- Gloria Mark, [How to sharpen your attention and meet your goals in 2024](https://www.universityofcalifornia.edu/news/how-sharpen-your-attention-and-meet-your-goals-2024)

## Working Conclusion

We do not need a new raw science of attention.

We need a new deterministic synthesis:

- sensorless
- agent-native
- behaviorally grounded
- traceable
- tuned for when to interrupt, when to defer, and how to spend human attention well

That synthesis is Aperture.
