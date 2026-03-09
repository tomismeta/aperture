# Human Attention Research

This document distills the human-attention concepts Aperture should borrow from psychology, human factors, and HCI.

The goal is not broad UX theory.

The goal is to sharpen the engine.

## Core Thesis

Aperture should not model only explicit actions.

It should model:

- explicit response
- silent response
- timing
- hesitation
- deferral
- abandonment
- return
- sequence
- comparative attention across competing frames

The engine should treat attention as behavior, not just clicks.

## What Aperture Must Be Good At

### 1. Interrupting at the right moment

Aperture should minimize badly timed interruptions.

Research on interruptions shows:

- interruptions change work strategy, not just task duration
- people often compensate by working faster
- that compensation increases stress, frustration, time pressure, and effort
- interruption timing matters

For Aperture, this means:

- do not maximize visibility
- maximize opportune interruption
- prefer breakpoints when possible
- distinguish urgent interruption from interruptibility

### 2. Managing vigilance over time

Humans do not sustain perfect attention.

Research on vigilance shows:

- sustained attention degrades with time-on-task
- stress and workload rise along with the decrement
- mind wandering tracks worsening attentional performance

For Aperture, this means:

- silence can mean depletion, not indifference
- latency should be read relative to recent attention load
- repeated low-value frames create attention debt
- the engine should rate ongoing attentional burden, not only individual frame priority

### 3. Preventing alarm fatigue

Alarm-fatigue research is directly relevant.

When people receive too many non-actionable signals:

- they become desensitized
- relevance judgments degrade
- response behavior changes
- important signals risk being treated like noise

For Aperture, this means:

- suppress low-value recurring frames aggressively
- distinguish actionable from non-actionable signals
- preserve trust in interruption by keeping interruption quality high
- treat false-positive attention demands as a serious product failure

### 4. Understanding attention as part of decision construction

Attention does not merely reflect a decision.

Research on attention and choice suggests:

- attention actively shapes the decision itself
- sequence and dwell affect what gets chosen
- what receives more attention often becomes more decisionally salient

For Aperture, this means:

- the order in which frames surface matters
- the engine should reason about comparative attention, not just isolated frames
- a choice is partly constructed by what was shown first, deferred, or ignored

### 5. Accounting for ambiguity aversion and pressure

Humans under pressure do not simply become slower or faster.

They also shift thresholds.

Research on triage and ambiguity suggests:

- people vary in tolerance for uncertainty
- pressure can shift decision thresholds
- ambiguity-averse operators may defer, avoid, or choose inconclusive paths

For Aperture, this means:

- repeated deferral can signal uncertainty aversion
- failure to act can reflect threshold movement, not lack of understanding
- the engine should separate:
  - low attention
  - high ambiguity
  - intentional deferral

### 6. Respecting shared and collective agency

In multi-agent supervision, the human is not acting alone in a vacuum.

Research on joint action suggests:

- agency can be individual and collective
- people reason differently when acting as part of a joint system
- coordination quality affects felt control

For Aperture, this means:

- frames should preserve source identity
- the human should know whether they are deciding:
  - for one agent
  - across many agents
  - on behalf of the whole system
- grouped attention should preserve the sense of "I am steering this" rather than "the system is dragging me"

## Silent Action

This is the most important principle for Aperture.

Explicit action is only part of the response.

Silent action is also response.

Examples:

- a long pause before approving
- choosing another frame first
- opening provenance before acting
- never opening provenance
- dismissing quickly
- letting a frame sit
- returning after context appears elsewhere
- never returning
- expanding one kind of context but never another

These are not absences.

They are behavioral signals.

## Engine Implications

### Signals Aperture Should Capture

Explicit:

- `responded`
- `dismissed`
- `form_submitted`
- `option_selected`

Silent / implicit:

- `viewed`
- `deferred`
- `suppressed`
- `timed_out`
- `abandoned`
- `returned`
- `context_expanded`
- `context_skipped`
- `attention_shifted`

Comparative:

- what frame won first attention
- what frame was ignored while another was handled
- what frame was only handled after another resolved

Temporal:

- time to first view
- time to first action
- time to context expansion
- time between deferral and return
- time spent inactive while still foregrounded

### Engine Questions To Answer

For each frame:

- should this interrupt now?
- should this stay ambient?
- should this wait behind another frame?
- is hesitation here a sign of uncertainty, overload, or disinterest?
- is this operator currently avoiding this class of frame?
- has this class of frame become noise?

Across frames:

- which frame is actually consuming attention?
- which queued frames are starved?
- what sequence reduces switching cost?
- what sequence preserves operator confidence?

### Minimal Behavioral States Worth Inferring

Without overengineering, Aperture should eventually estimate a few coarse states:

- `engaged`
- `hesitating`
- `overloaded`
- `avoiding`
- `monitoring`
- `done_for_now`

These should be inferred from behavior, not self-report.

## Research Areas Aperture Should Continue Following

### Human factors and interruption science

Use this for:

- interruption timing
- breakpoint selection
- recovery cost
- resumption lag

### Sustained attention and vigilance

Use this for:

- time-on-task degradation
- fatigue-aware scheduling
- mind wandering and attentional instability

### Alarm fatigue and alerting systems

Use this for:

- non-actionable noise suppression
- salience design
- trust preservation

### Decision science

Use this for:

- threshold shifts under pressure
- ambiguity aversion
- sequence effects
- constructive choice

### Joint action / shared agency

Use this for:

- collective control
- multi-agent supervision
- preserving operator authorship and trust

## Research To Do Ourselves

The literature is useful, but Aperture also needs product-specific research.

### Operator observation

Study people supervising:

- Codex sessions
- Claude Code sessions
- OpenClaw / Paperclip-like multi-agent systems

Watch for:

- what they ignore
- when they alt-tab or switch panes
- when they postpone action
- what they inspect before approving
- what they never inspect

### Sequence studies

Test:

- same set of frames, different ordering
- same frame, different interruption timing
- grouped vs ungrouped presentation
- provenance upfront vs on demand

Measure:

- response latency
- reversal rate
- dismissal rate
- perceived control
- switching cost

### Trust studies

Aperture should specifically test:

- when suppression feels helpful versus opaque
- when anticipation feels assistive versus creepy
- when grouping feels clarifying versus obscuring

## Source Notes

Key sources used here:

- Gloria Mark, Daniela Gudith, and Ulrich Klocke, “The Cost of Interrupted Work: More Speed and Stress” (CHI 2008): [PDF](https://www.ics.uci.edu/~gmark/chi08-mark.pdf)
- Philip L. Smith and Roger Ratcliff, “An integrated theory of attention and decision making in visual signal detection” (Psychological Review, 2009): [PubMed](https://pubmed.ncbi.nlm.nih.gov/19348543/)
- Cvach, “Monitor alarm fatigue: an integrative review” (Biomed Instrum Technol, 2012): [PubMed](https://pubmed.ncbi.nlm.nih.gov/22839984/)
- Helton et al., “The vigilance decrement reflects limitations in effortful attention, not mindlessness” (Hum Factors, 2004): [PubMed](https://pubmed.ncbi.nlm.nih.gov/14702988/)
- Zanesco et al., “Mind wandering is associated with worsening attentional vigilance” (J Exp Psychol Hum Percept Perform, 2024): [PubMed](https://pubmed.ncbi.nlm.nih.gov/39172363/)
- Orquin and Mueller Loose, “Attention and choice: a review on eye movements in decision making” (Acta Psychol, 2013): [PubMed](https://pubmed.ncbi.nlm.nih.gov/23845447/)
- Loehr, “The sense of agency in joint action: An integrative review” (Psychon Bull Rev, 2022): [PubMed](https://pubmed.ncbi.nlm.nih.gov/35146702/)
- Mattijssen et al., “Human Factors in Triaging Forensic Items: Casework Pressures and Ambiguity Aversion” (Forensic Sci Int Synerg, 2024): [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12503395/)
