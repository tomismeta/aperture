import assert from "node:assert/strict";
import test from "node:test";

import type { ApertureTrace } from "../../core/src/internal-contract.js";

import { renderWhyOverlay } from "../src/render-why.js";

function makeCandidateTrace(
  semantic: NonNullable<Extract<ApertureTrace, { evaluation: { kind: "candidate" } }>["semantic"]>,
): ApertureTrace {
  return {
    timestamp: "2026-03-27T20:00:00.000Z",
    event: {
      id: "evt:1",
      taskId: "task:1",
      timestamp: "2026-03-27T20:00:00.000Z",
      type: "human.input.requested",
      interactionId: "interaction:1",
      title: "Should we read the config first?",
      summary: "Choose the next step.",
      request: {
        kind: "choice",
        selectionMode: "single",
        options: [{ id: "yes", label: "Yes" }],
      },
      semantic: {
        intentFrame: semantic.intentFrame,
        ...(semantic.activityClass !== undefined ? { activityClass: semantic.activityClass } : {}),
        ...(semantic.toolFamily !== undefined ? { toolFamily: semantic.toolFamily } : {}),
        ...(semantic.consequence !== undefined ? { consequence: semantic.consequence } : {}),
        confidence: semantic.confidence ?? "low",
        ...(semantic.abstained === true ? { abstained: true } : {}),
        ...(semantic.whyNow !== undefined ? { whyNow: semantic.whyNow } : {}),
        relationHints: semantic.relationHints,
        factors: semantic.factors,
        reasons: semantic.reasons,
      },
    },
    evaluation: {
      kind: "candidate",
      original: {
        taskId: "task:1",
        interactionId: "interaction:1",
        timestamp: "2026-03-27T20:00:00.000Z",
        mode: "choice",
        priority: "normal",
        tone: "focused",
        consequence: "medium",
        title: "Should we read the config first?",
        responseSpec: {
          kind: "choice",
          allowTextResponse: false,
          options: [{ id: "yes", label: "Yes" }],
        },
        blocking: true,
      },
      adjusted: {
        taskId: "task:1",
        interactionId: "interaction:1",
        timestamp: "2026-03-27T20:00:00.000Z",
        mode: "choice",
        priority: "normal",
        tone: "focused",
        consequence: "medium",
        title: "Should we read the config first?",
        responseSpec: {
          kind: "choice",
          allowTextResponse: false,
          options: [{ id: "yes", label: "Yes" }],
        },
        blocking: true,
      },
    },
    heuristics: {
      scoreOffset: 0,
      rationale: [],
    },
    semantic,
    episode: null,
    policy: { gate: "allow", criterion: null, reasons: [] },
    policyRules: { gateEvaluations: [], criterion: null, criterionEvaluations: [] },
    utility: {
      candidate: {
        total: 100,
        components: {
          priority: 100,
          consequence: 10,
          tone: 1,
          blocking: 1000,
          heuristics: 0,
          sourceTrust: 0,
          consequenceCalibration: 0,
          responseAffinity: 0,
          contextCost: 0,
          deferralAffinity: 0,
        },
        rationale: [],
      },
      currentScore: null,
      currentPriority: null,
    },
    planner: { kind: "activate", reasons: ["no current frame is active for this task"], continuityEvaluations: [] },
    coordination: {
      kind: "activate",
      resultBucket: "active",
      candidateScore: 100,
      currentScore: null,
      currentPriority: null,
      criterion: null,
      ambiguity: null,
      reasons: ["no current frame is active for this task"],
      continuityEvaluations: [],
    },
    taskSummary: {
      counts: { presented: 0, responded: 0, dismissed: 0, contextExpanded: 0 },
      pending: { active: 0, queued: 0, ambient: 0 },
      deferred: { total: 0, suppressions: 0, resumed: 0, suppressed: 0 },
      responseRate: 0,
      dismissalRate: 0,
      averageResponseLatencyMs: null,
      averageDismissalLatencyMs: null,
    },
    globalSummary: {
      counts: { presented: 0, responded: 0, dismissed: 0, contextExpanded: 0 },
      pending: { active: 0, queued: 0, ambient: 0 },
      deferred: { total: 0, suppressions: 0, resumed: 0, suppressed: 0 },
      responseRate: 0,
      dismissalRate: 0,
      averageResponseLatencyMs: null,
      averageDismissalLatencyMs: null,
    },
    taskAttentionState: "steady",
    globalAttentionState: "steady",
    pressureForecast: { level: "low", score: 0, reasons: [] },
    attentionBurden: { level: "low", score: 0, reasons: [] },
    current: null,
    taskView: { current: null, backlog: [] },
    attentionView: { active: null, queued: [], ambient: [] },
    result: null,
  } as ApertureTrace;
}

test("renderWhyOverlay shows semantic summary and influence notes", () => {
  const output = renderWhyOverlay(
    makeCandidateTrace({
      intentFrame: "question_request",
      activityClass: "question_request",
      toolFamily: "read",
      consequence: "medium",
      confidence: "low",
      relationHints: [],
      factors: ["human.input.requested", "choice"],
      reasons: ["tool family was supplied by the source or context"],
      influence: ["tool family stayed explanatory on the question/form path"],
      impact: {
        decisionBearing: ["consequence (canonical)"],
        explanatory: ["intent", "tool", "confidence"],
      },
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        toolFamily: "source",
        consequence: "inferred",
        confidence: "inferred",
      },
    }),
    false,
    false,
  ).join("\n");

  assert.match(output, /semantics/);
  assert.match(output, /intent:\s+question_request/);
  assert.match(output, /activity:\s+question_request/);
  assert.match(output, /tool:\s+read/);
  assert.match(output, /consequence:\s+medium/);
  assert.match(output, /confidence:\s+low/);
  assert.match(output, /origin:\s+tool source/);
  assert.match(output, /used by:\s+consequence \(canonical\)/);
  assert.match(output, /explanatory:\s+intent · tool · confidence/);
  assert.match(output, /tool family stayed explanatory on the question\/form path/);
  assert.match(output, /basis:\s+tool family was supplied by the source or context/);
});

test("renderWhyOverlay shows semantic why-now text when available", () => {
  const output = renderWhyOverlay(
    makeCandidateTrace({
      intentFrame: "status_update",
      confidence: "low",
      whyNow: "Status text implies the operator may need to respond.",
      relationHints: [],
      factors: ["task.updated", "waiting"],
      reasons: ["status wording suggests an implied operator request"],
      influence: [
        "task status remained authoritative; semantic details stayed bounded to explanation, continuity, and ambiguity handling",
      ],
      impact: {
        decisionBearing: ["confidence (ambiguity)"],
        explanatory: ["intent", "why now"],
      },
      provenance: {
        intentFrame: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
      },
    }),
    false,
    false,
  ).join("\n");

  assert.match(output, /why now:/);
  assert.match(output, /Status text implies the operator may need to respond\./);
  assert.match(output, /used by:\s+confidence \(ambiguity\)/);
  assert.match(output, /explanatory:\s+intent · why now/);
  assert.match(output, /task status remained authoritative/);
  assert.doesNotMatch(output, /origin:/);
});

test("renderWhyOverlay shows hint-driven semantic provenance", () => {
  const output = renderWhyOverlay(
    makeCandidateTrace({
      intentFrame: "approval_request",
      consequence: "high",
      confidence: "low",
      whyNow: "A policy escalation requires senior review.",
      relationHints: [],
      factors: ["human.input.requested", "approval"],
      reasons: ["adapter provided a trusted escalation hint"],
      influence: ["semantic consequence shaped the canonical human-input consequence"],
      impact: {
        decisionBearing: ["consequence (canonical)"],
        explanatory: ["intent", "why now", "confidence"],
      },
      provenance: {
        intentFrame: "inferred",
        consequence: "hint",
        whyNow: "hint",
        confidence: "inferred",
      },
    }),
    false,
    false,
  ).join("\n");

  assert.match(output, /origin:\s+consequence hint · why now hint/);
  assert.match(output, /used by:\s+consequence \(canonical\)/);
  assert.match(output, /explanatory:\s+intent · why now · confidence/);
  assert.match(output, /A policy escalation requires senior review\./);
});
