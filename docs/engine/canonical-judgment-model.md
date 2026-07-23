# Canonical Judgment Model

This note describes the canonical data model for Aperture's event attention
judgment path.

It is a schema and boundary document, not a refactor plan. The goal is to make
the current model explicit and to name the recommended target state clearly
enough that future hardening work stays coherent.

## Why This Exists

Aperture is not driven by one giant event schema.

It is a staged system:

1. source facts arrive
2. source facts become shared meaning
3. shared meaning becomes an attention claim
4. the claim is judged in context
5. the result becomes surfaced state
6. human response and behavioral signals feed future judgment

That means multiple canonical schemas are correct. The goal is not to flatten
the engine into one type. The goal is to keep a small number of explicit schemas
with sharp boundaries.

## Canonical Pipeline

```json
{
  "pipeline": [
    "SourceEvent",
    "SemanticInterpretation",
    "ApertureEvent",
    "AttentionJudgmentInput",
    "AttentionCandidate",
    "AttentionEvidenceContext",
    "AttentionDecision",
    "AttentionFrame / AttentionView",
    "AttentionResponse + signals"
  ],
  "primary_equation": "AttentionCandidate + AttentionEvidenceContext -> AttentionDecision -> AttentionFrame/AttentionView"
}
```

## Current Canonical Shapes

```json
{
  "SourceEvent": {
    "role": "adapter-facing source fact model",
    "question": "What happened in the source system?"
  },
  "SemanticInterpretation": {
    "role": "core semantic meaning model",
    "question": "What does Aperture infer this event means?"
  },
  "ApertureEvent": {
    "role": "core semantic event model",
    "question": "What does Aperture believe this event means?"
  },
  "AttentionJudgmentInput": {
    "role": "compiled semantic/evidence seam",
    "question": "What compact semantic read should judgment consume?"
  },
  "AttentionCandidate": {
    "role": "attention claim model",
    "question": "What claim on human attention is being made?"
  },
  "AttentionEvidenceContext": {
    "role": "judgment context model",
    "question": "What surrounding conditions affect this claim right now?"
  },
  "AttentionDecision": {
    "role": "judgment result",
    "question": "Should this activate, wait until next, stay ambient, auto-resolve, or clear?"
  },
  "AttentionFrame / AttentionView": {
    "role": "surface model",
    "question": "What does the operator or client actually see?"
  },
  "AttentionResponse + signals": {
    "role": "feedback model",
    "question": "What did the human do, and what should the engine learn?"
  }
}
```

## Core Boundary

The core package has three meaningful input/output seams.

### Inputs To Core

```json
{
  "publishSourceEvent": {
    "input": "SourceEvent",
    "role": "adapter boundary"
  },
  "publish": {
    "input": "ApertureEvent",
    "role": "core semantic boundary"
  },
  "submit": {
    "input": "AttentionResponse",
    "role": "human response boundary"
  }
}
```

### Outputs From Core

```json
{
  "publishSourceEvent": {
    "output": "AttentionFrame | null"
  },
  "publish": {
    "output": "AttentionFrame | null"
  },
  "getAttentionView": {
    "output": "AttentionView"
  },
  "coordinator.explain": {
    "output": "AttentionDecisionExplanation"
  },
  "trace_stream": {
    "output": "ApertureTrace"
  }
}
```

## The Right Number Of Schemas

The current model effectively has eight major schemas plus a feedback family:

1. `SourceEvent`
2. `SemanticInterpretation`
3. `ApertureEvent`
4. `AttentionJudgmentInput`
5. `AttentionCandidate`
6. `AttentionEvidenceContext`
7. `AttentionDecision`
8. `AttentionFrame / AttentionView`
9. `AttentionResponse + signals + summaries`

That is the right order of magnitude for this engine.

We should not collapse this to one schema. Doing so would blur:

- source facts
- semantic interpretation
- compiled semantic evidence
- semantic meaning
- judgment state
- surfaced state
- feedback state

## Recommended Target State

The main recommendation is not "fewer schemas."

The main recommendation is:

- keep the staged model
- make the judgment handoff more explicit

Today, the engine already has:

- an explicit semantic handoff in `AttentionJudgmentInput`
- an internal `AttentionDecision` type in `JudgmentCoordinator`
- an internal `AttentionDecisionRecord` carried by `AttentionDecisionExplanation`

The remaining maturation work is making the decision artifact the clear shared
handoff across:

- judgment
- trace
- commit/application
- future replay/evaluation

The primitive direction is captured in
[Deterministic Attention Kernel](./deterministic-attention-kernel.md).

## Recommended Decision Handoff

```json
{
  "AttentionDecisionRecord": {
    "purpose": "first-class judgment artifact",
    "fields": {
      "decision": "AttentionDecision",
      "candidate": "AttentionCandidate",
      "evidenceSnapshot": {
        "pressureForecast": "AttentionPressure",
        "attentionBurden": "AttentionBurden",
        "operatorPresence": "present | absent",
        "currentFrameId": "string | null",
        "currentEpisodeId": "string | null"
      },
      "policy": {
        "verdict": "AttentionPolicyVerdict",
        "gateEvaluations": "PolicyGateRuleEvaluation[]",
        "criterion": "AttentionInterruptCriterionVerdict | null",
        "criterionEvaluations": "PolicyCriterionRuleEvaluation[]"
      },
      "value": {
        "breakdown": "AttentionValueBreakdown",
        "claimScore": "number",
        "currentScore": "number | null",
        "currentPriority": "AttentionPriority | null"
      },
      "planning": {
        "route": "auto_approve | activate | queue | ambient | clear",
        "plannedLane": "now | next | ambient | none",
        "ambiguity": "AttentionDecisionAmbiguity | null",
        "reasons": "string[]",
        "continuityEvaluations": "ContinuityRuleEvaluation[]"
      }
    }
  }
}
```

## Gaps In The Current Model

```json
{
  "gaps": [
    {
      "name": "decision record is internal but not yet the single trace and commit handoff",
      "effect": "the canonical artifact now exists, but trace projection and frame commit still carry some parallel representation"
    },
    {
      "name": "commit is implicit",
      "effect": "frame planning and task-view mutation are explicit in code but not modeled as one named artifact"
    },
    {
      "name": "feedback is stronger as summaries than as a first-class schema",
      "effect": "good enough for live judgment, but weaker for future replay/evaluation design"
    }
  ]
}
```

## Recommendation

This section describes the recommended target state, not a claim that the
engine has already fully reached it.

Short version:

```json
{
  "keep": [
    "SourceEvent",
    "ApertureEvent",
    "AttentionCandidate",
    "AttentionEvidenceContext",
    "AttentionFrame / AttentionView",
    "AttentionResponse + signals"
  ],
  "strengthen": ["AttentionDecision as the explicit judgment handoff"],
  "do_not_do": ["collapse the system to one schema"]
}
```

## What This Means For Future Refactors

Not now, but later, if the engine needs another structural hardening pass, the
right scope is:

1. `JudgmentCoordinator`
2. explanation output
3. trace recording
4. frame / view commit

That work should revolve around a stronger decision handoff, not around
flattening the whole pipeline.

## Code Anchors

- `SourceEvent`
  - `packages/core/src/source-event.ts`
- `SemanticInterpretation`
  - `packages/core/src/semantic-types.ts`
  - `packages/core/src/semantic-interpreter.ts`
- `ApertureEvent`
  - `packages/core/src/events.ts`
- `AttentionJudgmentInput`
  - `packages/core/src/judgment-input.ts`
- `AttentionCandidate`
  - `packages/core/src/interaction-candidate.ts`
- `AttentionEvidenceContext`
  - `packages/core/src/attention-evidence.ts`
- `AttentionDecision`
  - `packages/core/src/judgment-coordinator.ts`
- `AttentionFrame` and `AttentionView`
  - `packages/core/src/frame.ts`
