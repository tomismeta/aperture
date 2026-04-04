import test from "node:test";
import assert from "node:assert/strict";

import * as sdk from "../src/index.js";
import * as semanticSdk from "../src/semantic.js";
import * as traceSdk from "../src/trace.js";

test("@tomismeta/aperture-core exposes the intended public SDK surface", () => {
  assert.ok("ApertureCore" in sdk);

  assert.equal("AttentionAdjustments" in sdk, false);
  assert.equal("AttentionSignalStore" in sdk, false);
  assert.equal("EpisodeTracker" in sdk, false);
  assert.equal("EventEvaluator" in sdk, false);
  assert.equal("buildMemoryProfile" in sdk, false);
  assert.equal("scoreFrame" in sdk, false);
  assert.equal("serializeJudgmentConfig" in sdk, false);
  assert.equal("AdapterEvent" in sdk, false);
  assert.equal("MinimumPresentation" in sdk, false);
  assert.equal("JudgmentDecision" in sdk, false);
  assert.equal("DEFAULT_ATTENTION_SURFACE_CAPABILITIES" in sdk, false);
  assert.equal("AttentionEvidenceContext" in sdk, false);
  assert.equal("AttentionEvidenceInput" in sdk, false);
  assert.equal("PolicyCriterionRuleEvaluation" in sdk, false);
  assert.equal("PolicyGateRuleEvaluation" in sdk, false);
  assert.equal("ContinuityRuleEvaluation" in sdk, false);
  assert.equal("ContinuityRuleName" in sdk, false);
  assert.equal("createAttentionEvidenceContext" in sdk, false);
  assert.equal("resolveAttentionEvidenceContext" in sdk, false);
  assert.equal("isAttentionEvidenceContext" in sdk, false);
  assert.equal("selectPeripheralBucket" in sdk, false);
  assert.equal("evaluateConfiguredPolicyGateRule" in sdk, false);
  assert.equal("evaluateBlockingPolicyGateRule" in sdk, false);
  assert.equal("evaluateInterruptEligibilityCriterionRule" in sdk, false);
  assert.equal("evaluateSourceTrustCriterionRule" in sdk, false);
  assert.equal("evaluateAttentionBudgetCriterionRule" in sdk, false);
  assert.equal("noopContinuityRule" in sdk, false);
  assert.equal("overrideContinuityRule" in sdk, false);
  assert.equal("containsAnySemanticPhrase" in sdk, false);
  assert.equal("dedupeSemanticStrings" in sdk, false);
  assert.equal("detectImpliedOperatorAsk" in sdk, false);
  assert.equal("detectSemanticRelationHints" in sdk, false);
  assert.equal("inferConsequenceFromSemanticText" in sdk, false);
  assert.equal("inferSemanticToolFamily" in sdk, false);
  assert.equal("normalizeSemanticText" in sdk, false);
  assert.equal("readExplicitSemanticToolFamily" in sdk, false);
  assert.equal("hasSemanticRelationKind" in sdk, false);
  assert.equal("readSemanticRelationTarget" in sdk, false);
  assert.equal("semanticActivityClassForRequestKind" in sdk, false);
  assert.equal("semanticIntentFrameForRequestKind" in sdk, false);
  assert.equal("semanticReasonsForLifecycle" in sdk, false);
  assert.equal("semanticReasonsForTaskStatus" in sdk, false);
  assert.equal("semanticWhyNowForRequestKind" in sdk, false);
  assert.equal("semanticWhyNowForTaskStatus" in sdk, false);
  assert.equal("interpretSourceEvent" in sdk, false);
  assert.equal("AttentionPolicy" in sdk, false);
  assert.equal("AttentionValue" in sdk, false);
  assert.equal("AttentionPlanner" in sdk, false);
  assert.equal("JudgmentCoordinator" in sdk, false);
  assert.equal("forecastAttentionPressure" in sdk, false);
  assert.equal("idleAttentionPressure" in sdk, false);
  assert.equal("distillMemoryProfile" in sdk, false);
  assert.equal("ProfileStore" in sdk, false);
  assert.equal("evaluateTraceSession" in sdk, false);
  assert.equal("scoreAttentionFrame" in sdk, false);
  assert.equal("APERTURE_STATE_SCHEMA_VERSION" in sdk, false);
  assert.equal("MARKDOWN_SCHEMA_VERSION" in sdk, false);
  assert.equal("AttentionField" in sdk, false);
  assert.equal("AttentionResponseSpec" in sdk, false);
  assert.equal("AttentionSignalSummary" in sdk, false);
  assert.equal("AttentionState" in sdk, false);
  assert.equal("ApertureTrace" in sdk, false);
  assert.equal("isCandidateTrace" in sdk, false);

  assert.equal(typeof sdk.baseAttentionSurfaceCapabilities, "object");
  assert.equal(typeof sdk.mergeAttentionSurfaceCapabilities, "function");
});

test("public SDK supports the simple event in -> frame out -> response in loop", () => {
  const core = new sdk.ApertureCore();
  const seenResponses: sdk.AttentionResponse[] = [];

  core.onResponse((response) => {
    seenResponses.push(response);
  });

  const frame = core.publish({
    id: "evt:simple-loop",
    taskId: "task:simple-loop",
    timestamp: "2026-03-15T18:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:simple-loop",
    title: "Approve production deploy",
    summary: "A deployment is waiting for approval.",
    request: { kind: "approval" },
  });

  assert.ok(frame);
  assert.equal(frame?.title, "Approve production deploy");
  assert.equal(frame?.responseSpec?.kind, "approval");
  assert.equal(core.getAttentionView().active?.interactionId, "interaction:simple-loop");

  core.submit({
    taskId: "task:simple-loop",
    interactionId: "interaction:simple-loop",
    response: { kind: "approved" },
  });

  assert.equal(seenResponses.length, 1);
  assert.deepEqual(seenResponses[0], {
    taskId: "task:simple-loop",
    interactionId: "interaction:simple-loop",
    response: { kind: "approved" },
  });
  assert.equal(core.getSignals("task:simple-loop").at(-1)?.kind, "responded");
});

test("public SDK exposes surface capability types through the root package", () => {
  const surfaceCapabilities: sdk.AttentionSurfaceCapabilities = {
    topology: {
      supportsAmbient: false,
    },
    responses: {
      supportsSingleChoice: true,
      supportsMultipleChoice: false,
      supportsForm: false,
      supportsTextResponse: true,
    },
  };

  const core = new sdk.ApertureCore({
    surfaceCapabilities,
  });

  assert.equal(core.getSurfaceCapabilities().topology.supportsAmbient, false);
  assert.equal(core.getSurfaceCapabilities().responses.supportsForm, false);
  assert.equal(core.getSurfaceCapabilities().responses.supportsTextResponse, true);
});

test("public SDK exposes surface capability helpers through the root package", () => {
  const merged = sdk.mergeAttentionSurfaceCapabilities([
    sdk.baseAttentionSurfaceCapabilities,
    {
      topology: {
        supportsAmbient: false,
      },
      responses: {
        supportsSingleChoice: true,
        supportsMultipleChoice: false,
        supportsForm: false,
        supportsTextResponse: true,
      },
    },
  ]);

  assert.equal(merged.topology.supportsAmbient, false);
  assert.equal(merged.responses.supportsForm, false);
  assert.equal(merged.responses.supportsTextResponse, false);
});

test("advanced semantic helpers live behind the semantic subpath", () => {
  assert.equal("interpretSourceEvent" in sdk, false);
  assert.equal("normalizeSourceEvent" in sdk, false);

  assert.equal(typeof semanticSdk.interpretSourceEvent, "function");
  assert.equal(typeof semanticSdk.normalizeSourceEvent, "function");
});

test("trace helpers live behind the trace subpath", () => {
  assert.equal("ApertureTrace" in sdk, false);
  assert.equal("isCandidateTrace" in sdk, false);

  assert.equal(typeof traceSdk.isCandidateTrace, "function");
});

test("public SDK supports trace inspection through the trace subpath", () => {
  const core = new sdk.ApertureCore();
  const traces: Array<ReturnType<typeof captureTrace>> = [];

  core.onTrace((trace) => {
    traces.push(captureTrace(trace));
  });

  core.publishSourceEvent({
    id: "src:trace-sdk",
    type: "human.input.requested",
    taskId: "task:trace-sdk",
    interactionId: "interaction:trace-sdk",
    timestamp: "2026-04-04T18:00:00.000Z",
    source: { id: "custom-agent" },
    title: "Should we inspect the config first?",
    summary: "Choose the next step.",
    context: {
      items: [{ id: "toolFamily", label: "Tool Family", value: "read" }],
    },
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
  });

  const trace = traces.at(-1);
  assert.ok(trace);
  if (!trace) {
    return;
  }

  assert.equal(trace.evaluation.kind, "candidate");
  assert.equal(traceSdk.isCandidateTrace(trace), true);
  if (!traceSdk.isCandidateTrace(trace)) {
    return;
  }

  assert.equal(trace.semantic?.toolFamily, "read");
  assert.deepEqual(trace.semantic?.impact.decisionBearing, ["activity (canonical)", "consequence (canonical)"]);
  assert.equal(trace.coordination.kind, "activate");
});

function captureTrace(trace: Parameters<sdk.AttentionTraceListener>[0]) {
  return trace;
}
