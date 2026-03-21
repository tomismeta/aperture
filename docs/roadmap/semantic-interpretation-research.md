# Semantic Interpretation Research Sprint

This document captures a focused research sprint on semantic interpretation,
event relations, abstention, and attention management as they relate to
Aperture Core.

The goal is not to survey NLP broadly.

The goal is to answer a narrower question:

**What kind of semantic system should Aperture build if it wants deterministic judgment without boxing itself into today's heuristics?**

## Research Questions

This sprint was organized around five questions:

1. how should Aperture represent semantic meaning?
2. how should interpretation stay separate from deterministic execution?
3. how hard is event relation understanding really?
4. how should ambiguity and abstention work?
5. what does attention-management research imply for interruption and deferral?

## Main Conclusions

### 1. Aperture should model bounded event semantics, not general NLP

The most useful semantic reference is frame semantics.

[Global FrameNet](https://www.globalframenet.org/) describes FrameNet as the
computational application of frame semantics, where meaning is modeled using
semantic frames and their relations rather than isolated keywords or labels.

That maps cleanly to Aperture.

Aperture does not need broad natural-language understanding. It needs a bounded
set of event frames such as:

- `approval_request`
- `question_request`
- `form_request`
- `blocked_work`
- `failure`
- `status_update`
- `completion`
- `cancellation`

This suggests a durable semantic contract:

- semantic interpretation should produce **canonical event meaning**
- not just phrase matches
- not freeform rationale
- not route decisions directly

### 2. Interpretation should be structured, validated, and then executed deterministically

[Rasa CALM's Command Generator](https://rasa.com/docs/pro/customize/command-generator/)
is the closest practical architecture reference.

Rasa's model is:

- interpret input into structured commands
- validate resulting state
- execute deterministic flows on top of that state

Two parts are especially relevant:

- the command-generator layer, which turns messy input into a bounded command
  vocabulary
- slot validation, where [slot definitions enforce technical constraints](https://rasa.com/docs/pro/build/assistant-memory/)
  before the system proceeds

That is very close to what Aperture should do with `SourceEvent` ingestion:

`SourceEvent -> SemanticInterpretation -> ApertureEvent -> deterministic judgment`

The important lesson is not "use an LLM command generator."

The important lesson is:

- interpretation should output **bounded structure**
- structure should be **validated**
- downstream execution should remain **deterministic**

### 3. Rule-based semantic extraction is still a strong baseline when the domain is narrow

For bounded extraction, rule-based systems remain very relevant.

[spaCy's rule-based matching](https://spacy.io/usage/rule-based-matching/) and
[EntityRuler](https://spacy.io/api/entityruler) are good examples of a
deterministic pattern layer that can stand on its own or complement stronger
models.

[Duckling](https://github.com/facebook/duckling) is another strong reference:
it explicitly presents itself as "language, engine, and tooling for expressing,
testing, and evaluating composable language rules on input strings."

The lesson for Aperture is not to copy those systems wholesale.

The lesson is:

- pattern systems work well when the semantic space is narrow
- rules should be composable and testable
- rule authorship should be explicit
- semantics should be represented separately from routing

This supports Aperture's current direction:

- deterministic semantic interpretation in core
- no hidden remote calls
- no dependency-heavy NLP stack in the hot path

### 4. Event relation understanding is important and still difficult

[EventRelBench](https://aclanthology.org/2025.findings-emnlp.482/) is the most
relevant recent benchmark for Aperture's continuity ambitions.

Its key message is highly relevant:

- event relations like coreference, temporal order, causality, and supersession
  are central to understanding complex text
- current general-purpose LLMs still struggle with them

This matters because Aperture continuity depends on exactly these judgments:

- is this the same issue?
- does this resolve the earlier issue?
- does this supersede the old plan?
- is this escalation or mere repetition?

The implication is clear:

- Aperture should keep relation semantics **narrow and explicit**
- relation understanding should be **benchmarked directly**
- continuity should not assume generic language models already solve this well

### 5. Abstention is not optional; it is part of the product

[The Art of Abstention](https://aclanthology.org/2021.acl-long.84.pdf) argues
that selective prediction allows a system to abstain on uncertain cases and
reduce error, and that in many real-world settings it is desirable for a model
to admit uncertainty and call for human help or a more capable system.

That maps directly to Aperture.

For Aperture, abstention should not mean "do nothing."

It should mean one of:

- stay ambient
- stay queued
- preserve source facts but avoid interpretive escalation
- mark semantics as weak or ambiguous

This is one of the most important research takeaways for the roadmap:

**Aperture should treat abstention as a first-class success mode, not as failure.**

### 6. Attention-management research reinforces queueing, deferral, and timing

[A Survey of Attention Management Systems](https://arxiv.org/abs/1806.06771)
argues that attention-management systems should postpone notifications to
opportune moments and ground their behavior in models of attention.

[Iqbal and Horvitz's CHI 2007 study](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/CHI_2007_Iqbal_Horvitz-1.pdf)
adds an especially Aperture-relevant point: interruptions increase the time to
resume suspended tasks, and the challenge is not only resumption of the task but
also returning focus to the right task among competing demands.

For Aperture, this reinforces several existing design choices:

- interruption quality matters more than visibility volume
- `queue` and `ambient` are not fallback buckets; they are attention-management tools
- continuity and minimum dwell are core product behavior, not polish
- resumption support is part of the product, not just interruption support

## What Aperture Should Borrow

### Borrow from FrameNet

- think in **semantic frames**
- treat meaning as structured scenes and relations
- keep the frame vocabulary small and product-driven

### Borrow from Rasa CALM

- interpretation and execution should be separate
- structured outputs should be validated before execution
- stateful slots are a good model for durable semantic facts

### Borrow from spaCy and Duckling

- deterministic rule layers are useful when the domain is narrow
- use composable rules, not giant monoliths
- treat the rule layer as software that is versioned and tested

### Borrow from EventRelBench

- continuity needs its own benchmark surface
- event relation understanding deserves direct evaluation
- do not assume generic LLM reasoning is good enough here

### Borrow from abstention literature

- low-confidence semantics should not be forced into brittle certainty
- abstention should map to peripheral handling, not silent failure

### Borrow from attention-management research

- timing and resumption cost matter
- interruption should be scarce and carefully earned
- queuing and deferral are first-class behavior

## What Aperture Should Not Borrow

- do not import a broad NLP platform into core
- do not make the semantic layer a hidden model wrapper
- do not let semantics directly bypass deterministic judgment
- do not widen the semantic schema around today's heuristics alone
- do not assume explanation fields and decision-bearing fields are the same thing

## Implications For Aperture Core

### 1. Aperture needs a semantic contract, not just a semantic implementation

The stable asset is not the current phrase list.

The stable asset should be:

- the semantic schema
- precedence between explicit source facts and inferred meaning
- the division between:
  - decision-bearing semantics
  - explanatory semantics
  - abstained or uncertain semantics

### 2. Explicit source truth should beat generic inference

This should remain the default precedence:

- canonical `ApertureEvent` meaning wins
- explicit `SourceEvent` hints win over generic inference
- generic deterministic inference fills gaps only when source truth is missing

This preserves future flexibility without making the engine opaque.

### 3. Relation semantics should stay narrow

Near-term relation kinds like:

- `same_issue`
- `repeats`
- `resolves`
- `supersedes`
- `escalates`

are a good shape.

They are product-relevant, testable, and legible.

The wrong move would be to expand quickly into a large, fuzzy ontology before
the current set is well-benchmarked against real sessions.

### 4. Confidence should probably influence escalation policy before it influences routing directly

Confidence is useful, but it should not become a hidden second score.

Near-term, it is more useful for:

- abstention policy
- explanation
- benchmark evaluation
- deciding when to stay peripheral

than for becoming a free-floating multiplier inside utility scoring.

### 5. Judgment should remain deterministic over canonical semantics

This is the most important architectural constraint to preserve.

The future-safe version of Aperture is:

- semantics can evolve
- interpreters can improve
- source-specific paths can vary
- but judgment always consumes explicit canonical meaning

That is what keeps the product legible.

## Research-Driven Roadmap Advice

### Do next

1. settle the semantic contract for `SourceEvent`
2. distinguish decision-bearing semantic fields from explanation-only ones
3. add abstention / ambiguity handling as a first-class contract
4. add parity tests between semantically equivalent `SourceEvent` and `ApertureEvent` paths
5. harvest real source-event bundles for continuity and semantic benchmarks

### Do later

1. stronger relation reasoning
2. optional richer interpreters behind the same semantic contract
3. broader continuity and resumption benchmarking from harvested sessions

### Avoid

1. dependency-heavy NLP in core
2. hidden remote semantic services in the hot path
3. over-expanding the semantic ontology before real bundle replay exists

## Bottom Line

The current direction is good.

The thing to protect is not today's heuristic implementation.

The thing to protect is:

- a stable semantic contract
- deterministic downstream judgment
- explicit precedence of source truth over inference
- first-class abstention for uncertain semantics

That direction does not box Aperture in.

It is what keeps Aperture flexible enough to evolve from:

- today's deterministic semantic layer

to

- stronger source-specific interpreters
- better relation reasoning
- harvested-reality benchmarking

without sacrificing the determinism of the judgment engine itself.

## Sources

- [Global FrameNet](https://www.globalframenet.org/)
- [Rasa CALM](https://rasa.com/docs/learn/concepts/calm)
- [Rasa Command Generator](https://rasa.com/docs/pro/customize/command-generator/)
- [Rasa Assistant Memory (Slots)](https://rasa.com/docs/pro/build/assistant-memory/)
- [spaCy Rule-based Matching](https://spacy.io/usage/rule-based-matching/)
- [spaCy EntityRuler](https://spacy.io/api/entityruler)
- [Duckling](https://github.com/facebook/duckling)
- [EventRelBench](https://aclanthology.org/2025.findings-emnlp.482/)
- [The Art of Abstention](https://aclanthology.org/2021.acl-long.84.pdf)
- [A Survey of Attention Management Systems](https://arxiv.org/abs/1806.06771)
- [Disruption and Recovery of Computing Tasks](https://www.microsoft.com/en-us/research/publication/disruption-and-recovery-of-computing-tasks-field-study-analysis-and-directions/)
