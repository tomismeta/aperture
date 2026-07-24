import assert from "node:assert/strict";
import test from "node:test";

import {
  auditSessionBundleReplay,
  auditSessionBundleReplays,
  createSessionBundle,
  runReplayScenario,
  SESSION_REPLAY_AUDIT_SCHEMA_VERSION,
  type ReplayScenario,
  type ReplaySessionBundle,
} from "../src/index.js";

const LOW_CONFIDENCE_FAILURE_SCENARIO: ReplayScenario = {
  id: "audit:low-confidence-failure",
  title: "Low-confidence failure audit",
  doctrineTags: ["harvested", "failure", "ambiguity"],
  steps: [
    {
      kind: "publishSource",
      label: "uncertain failure",
      event: {
        id: "src:audit:failure",
        taskId: "task:audit:failure",
        timestamp: "2026-03-28T14:00:00.000Z",
        source: { id: "claude-code", kind: "agent", label: "Claude Code" },
        type: "task.updated",
        status: "failed",
        title: "Build may have failed",
        summary: "The build may have failed; the signal is not fully clear yet.",
        semanticHints: {
          confidence: "low",
        },
      },
    },
  ],
};

test("session replay audit marks stable harvested pressure as review candidate", () => {
  const bundle = createAuditBundle("session:audit:low-confidence-failure");
  const audit = auditSessionBundleReplay({ bundle, path: "/tmp/low-confidence.json" });

  assert.equal(audit.schemaVersion, SESSION_REPLAY_AUDIT_SCHEMA_VERSION);
  assert.equal(audit.sessionId, "session:audit:low-confidence-failure");
  assert.equal(audit.path, "/tmp/low-confidence.json");
  assert.equal(audit.repeatability.stable, true);
  assert.equal(audit.fidelity.finalView.status, "match");
  assert.equal(audit.fidelity.decisions.fingerprintStatusCounts.match, 1);
  assert.equal(audit.fidelity.semantics.statusCounts.match, 1);
  assert.equal(audit.coverage.comparableDecisionFingerprints, 1);
  assert.equal(audit.coverage.comparableSemanticSnapshots, 1);
  assert.equal(audit.pressure.semanticSourceEvents, 1);
  assert.equal(audit.pressure.lowConfidenceDecisions, 1);
  assert.equal(audit.pressure.ambiguousDecisions, 1);
  assert.equal(audit.review.status, "candidate");
  assert.ok(audit.review.cues.includes("uncertainty_edge"));
});

test("session replay audit does not treat missing historical fingerprints as drift", () => {
  const bundle = createAuditBundle("session:audit:missing-fingerprint");
  const firstDecision = bundle.decisionSnapshots[0];
  assert.ok(firstDecision);
  const missingFingerprintDecision = { ...firstDecision };
  delete missingFingerprintDecision.decisionRecordCandidateScore;
  delete missingFingerprintDecision.decisionRecordFingerprint;
  delete missingFingerprintDecision.decisionRecordProjectionVersion;
  delete missingFingerprintDecision.decisionRecordReasonCodes;
  delete missingFingerprintDecision.decisionRecordRoute;
  delete missingFingerprintDecision.plannedLane;
  const missingFingerprintBundle: ReplaySessionBundle = {
    ...bundle,
    decisionSnapshots: [missingFingerprintDecision],
  };
  const audit = auditSessionBundleReplay(missingFingerprintBundle);

  assert.equal(audit.fidelity.decisions.fingerprintStatusCounts.unavailable, 1);
  assert.equal(audit.fidelity.decisions.fingerprintStatusCounts.mismatch, 0);
  assert.equal(audit.fidelity.decisions.fieldDriftStepIndices.length, 0);
  assert.equal(audit.review.status, "candidate");
  assert.ok(audit.review.cues.includes("unavailable_capture_projection"));
});

test("session replay audit sends fingerprint mismatch to inspection", () => {
  const bundle = createAuditBundle("session:audit:fingerprint-drift");
  const firstDecision = bundle.decisionSnapshots[0];
  assert.ok(firstDecision);
  const driftedBundle: ReplaySessionBundle = {
    ...bundle,
    decisionSnapshots: [
      {
        ...firstDecision,
        decisionRecordFingerprint: `sha256:${"0".repeat(64)}`,
      },
    ],
  };
  const audit = auditSessionBundleReplay(driftedBundle);

  assert.equal(audit.fidelity.decisions.fingerprintStatusCounts.mismatch, 1);
  assert.equal(audit.review.status, "inspect");
  assert.ok(audit.review.cues.includes("decision_drift"));
});

test("session replay audit sends legacy decision route drift to inspection", () => {
  const bundle = createAuditBundle("session:audit:legacy-route-drift");
  const firstDecision = bundle.decisionSnapshots[0];
  assert.ok(firstDecision);
  const currentRoute = firstDecision.decisionRecordRoute ?? firstDecision.decisionKind;
  assert.ok(currentRoute);
  const legacyDecision = { ...firstDecision };
  delete legacyDecision.decisionRecordCandidateScore;
  delete legacyDecision.decisionRecordFingerprint;
  delete legacyDecision.decisionRecordProjectionVersion;
  delete legacyDecision.decisionRecordReasonCodes;
  delete legacyDecision.decisionRecordRoute;
  delete legacyDecision.plannedLane;
  legacyDecision.decisionKind = currentRoute === "ambient" ? "queue" : "ambient";
  const driftedBundle: ReplaySessionBundle = {
    ...bundle,
    decisionSnapshots: [legacyDecision],
  };
  const audit = auditSessionBundleReplay(driftedBundle);

  assert.equal(audit.fidelity.decisions.fingerprintStatusCounts.unavailable, 1);
  assert.deepEqual(audit.fidelity.decisions.fieldDriftStepIndices, [0]);
  assert.deepEqual(audit.fidelity.decisions.comparisons[0]?.fieldDrifts, ["route"]);
  assert.equal(audit.review.status, "inspect");
  assert.ok(audit.review.cues.includes("decision_drift"));
});

test("session replay audit sends ontology drift to inspection", () => {
  const bundle = createAuditBundle("session:audit:ontology-drift");
  const firstSemantic = bundle.semanticSnapshots[0];
  assert.ok(firstSemantic?.ontology);
  const driftedBundle: ReplaySessionBundle = {
    ...bundle,
    semanticSnapshots: [
      {
        ...firstSemantic,
        ontology: {
          ...firstSemantic.ontology,
          ask: firstSemantic.ontology.ask === "none" ? "approval" : "none",
        },
      },
    ],
  };
  const audit = auditSessionBundleReplay(driftedBundle);

  assert.equal(audit.fidelity.semantics.statusCounts.mismatch, 1);
  assert.equal(audit.review.status, "inspect");
  assert.ok(audit.review.cues.includes("semantic_drift"));
});

test("session replay audit sends duplicate captured step indices to inspection", () => {
  const bundle = createAuditBundle("session:audit:duplicate-step-index");
  const firstDecision = bundle.decisionSnapshots[0];
  const firstSemantic = bundle.semanticSnapshots[0];
  assert.ok(firstDecision);
  assert.ok(firstSemantic?.ontology);
  const corruptedBundle: ReplaySessionBundle = {
    ...bundle,
    decisionSnapshots: [
      ...bundle.decisionSnapshots,
      {
        ...firstDecision,
        decisionKind: "ambient",
      },
    ],
    semanticSnapshots: [
      ...bundle.semanticSnapshots,
      {
        ...firstSemantic,
        ontology: {
          ...firstSemantic.ontology,
          ask: firstSemantic.ontology.ask === "none" ? "approval" : "none",
        },
      },
    ],
  };
  const audit = auditSessionBundleReplay(corruptedBundle);

  assert.deepEqual(audit.fidelity.decisions.duplicateCapturedStepIndices, [0]);
  assert.deepEqual(audit.fidelity.semantics.duplicateCapturedStepIndices, [0]);
  assert.equal(audit.review.status, "inspect");
  assert.ok(audit.review.cues.includes("capture_corruption"));
});

test("session replay audit aligns decisions by step index", () => {
  const bundle = createTwoStepBundle("session:audit:step-alignment");
  const firstDecision = bundle.decisionSnapshots[0];
  const secondDecision = bundle.decisionSnapshots[1];
  assert.ok(firstDecision);
  assert.ok(secondDecision);
  const missingFirstCapturedDecisionBundle: ReplaySessionBundle = {
    ...bundle,
    decisionSnapshots: [secondDecision],
  };
  const audit = auditSessionBundleReplay(missingFirstCapturedDecisionBundle);

  assert.deepEqual(audit.fidelity.decisions.missingCapturedStepIndices, [0]);
  assert.deepEqual(audit.fidelity.decisions.missingReplayedStepIndices, []);
  assert.equal(audit.review.status, "inspect");
});

test("session replay audit report preserves duplicate sessions and duplicate inputs", () => {
  const first = createAuditBundle("session:audit:duplicate");
  const duplicateSession = createAuditBundle("session:audit:duplicate");
  const duplicateInput = createAuditBundle("session:audit:duplicate-input");
  const report = auditSessionBundleReplays([
    { bundle: first, path: "/tmp/a.json" },
    { bundle: duplicateSession, path: "/tmp/b.json" },
    { bundle: duplicateInput, path: "/tmp/c.json" },
  ]);

  assert.equal(report.summary.totalBundles, 3);
  assert.equal(report.summary.candidateBundles, 3);
  assert.equal(report.duplicateSessionIds.length, 1);
  assert.deepEqual(report.duplicateSessionIds[0]?.paths, ["/tmp/a.json", "/tmp/b.json"]);
  assert.equal(report.duplicateInputDigests.length, 1);
  assert.deepEqual(report.duplicateInputDigests[0]?.sessionIds, [
    "session:audit:duplicate",
    "session:audit:duplicate",
    "session:audit:duplicate-input",
  ]);
});

function createAuditBundle(sessionId: string): ReplaySessionBundle {
  return createSessionBundle(runReplayScenario(LOW_CONFIDENCE_FAILURE_SCENARIO), {
    sessionId,
    source: { id: "claude-code", kind: "runtime", redacted: true },
    exportedAt: "2026-03-28T14:01:00.000Z",
  });
}

function createTwoStepBundle(sessionId: string): ReplaySessionBundle {
  return createSessionBundle(
    runReplayScenario({
      ...LOW_CONFIDENCE_FAILURE_SCENARIO,
      id: "audit:two-step",
      title: "Two-step audit",
      steps: [
        ...LOW_CONFIDENCE_FAILURE_SCENARIO.steps,
        {
          kind: "publishSource",
          label: "clear failure",
          event: {
            id: "src:audit:clear-failure",
            taskId: "task:audit:failure",
            timestamp: "2026-03-28T14:01:00.000Z",
            source: { id: "claude-code", kind: "agent", label: "Claude Code" },
            type: "task.updated",
            status: "failed",
            title: "Build failed",
            summary: "The build failed and needs attention.",
            semanticHints: {
              confidence: "high",
            },
          },
        },
      ],
    }),
    {
      sessionId,
      exportedAt: "2026-03-28T14:02:00.000Z",
    },
  );
}
