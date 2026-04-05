import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assignAutoresearchProposalSplits,
  buildAutoresearchProposalCodeRecommendations,
  buildAutoresearchProposalIntentStatements,
  collectAutoresearchProposalSignals,
  renderAutoresearchProposalMarkdown,
  selectAutoresearchProposalPromotions,
  type AutoresearchProposalSignal,
  type OfflineReviewBatchReport,
  type OfflineReviewRecommendationReport,
  type OfflineReviewReport,
} from "../src/index.js";
import { determineAutoresearchProposalDiscoveryStatus } from "../src/autoresearch-propose-command.js";

test("collectAutoresearchProposalSignals clusters repeated promoted disagreements across sessions", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aperture-autoresearch-proposal-"));
  const reportsDir = path.join(repoRoot, "reports");
  const recommendationsDir = path.join(repoRoot, "recommendations");
  await mkdir(reportsDir, { recursive: true });
  await mkdir(recommendationsDir, { recursive: true });

  const reportPaths: string[] = [];
  const recommendationPaths: string[] = [];
  for (const sessionId of ["session-a", "session-b"]) {
    const reportPath = path.join(reportsDir, `${sessionId}.json`);
    const recommendationPath = path.join(recommendationsDir, `${sessionId}.json`);
    const report: OfflineReviewReport = {
      schemaVersion: 1,
      generatedAt: "2026-03-28T00:00:00.000Z",
      rubricVersion: "offline-ai-review-v1",
      bundle: {
        sessionId,
        title: sessionId,
      },
      review: {
        reviewer: "openclaw",
        model: "gpt-5.4",
      },
      summary: {
        totalFindings: 1,
        disagreementCount: 1,
        matchedFindings: 0,
        disagreementsByFocusArea: {
          title: 0,
          summary: 0,
          status: 0,
          intentFrame: 1,
          toolFamily: 0,
          consequence: 0,
          blocking: 0,
          episode: 0,
          confidence: 0,
        },
      },
      disagreements: [
        {
          stepIndex: 5,
          stepLabel: "tool:observation",
          focusArea: "intentFrame",
          apertureValue: "failure",
          expectedValue: "status_update",
          confidence: "high",
          recommendation: "promote",
        },
      ],
    };
    const recommendation: OfflineReviewRecommendationReport = {
      schemaVersion: 1,
      generatedAt: "2026-03-28T00:00:00.000Z",
      rubricVersion: "offline-ai-review-v1",
      status: "disagreement",
      bundle: {
        sessionId,
        title: sessionId,
      },
      review: {
        reviewer: "openclaw",
        model: "gpt-5.4",
      },
      summary: {
        disagreementCount: 1,
        actionableCount: 1,
        recommendationCounts: {
          promote: 1,
          inspect: 0,
          ignore: 0,
        },
      },
      items: [
        {
          focusArea: "intentFrame",
          owner: "semantic",
          targets: ["packages/core/src/semantic-interpreter.ts"],
          recommendation: "promote",
          disagreementCount: 1,
          confidenceCounts: {
            high: 1,
            medium: 0,
            low: 0,
          },
          summary: "Tighten semantic intent-frame reads on imported external events.",
          examples: [],
        },
      ],
    };

    await writeJson(reportPath, report);
    await writeJson(recommendationPath, recommendation);
    reportPaths.push(reportPath);
    recommendationPaths.push(recommendationPath);
  }

  const batchReportPath = path.join(repoRoot, "batch.json");
  const reportPathA = reportPaths[0];
  const reportPathB = reportPaths[1];
  const recommendationPathA = recommendationPaths[0];
  const recommendationPathB = recommendationPaths[1];
  assert.ok(reportPathA);
  assert.ok(reportPathB);
  assert.ok(recommendationPathA);
  assert.ok(recommendationPathB);
  const batchReport: OfflineReviewBatchReport = {
    schemaVersion: 1,
    generatedAt: "2026-03-28T00:00:00.000Z",
    reviewer: {
      provider: "openclaw",
      command: "pnpm lab:fstop:reviewer --provider openclaw",
    },
    input: {
      imported: true,
      bundles: [],
    },
    summary: {
      bundleCount: 2,
      statusCounts: {
        clean: 0,
        disagreement: 2,
        error: 0,
      },
      disagreementCount: 2,
      actionableCount: 2,
      focusAreaCounts: {
        title: 0,
        summary: 0,
        status: 0,
        intentFrame: 2,
        toolFamily: 0,
        consequence: 0,
        blocking: 0,
        episode: 0,
        confidence: 0,
      },
      recommendationCounts: {
        promote: 2,
        inspect: 0,
        ignore: 0,
      },
    },
    entries: [
      {
        sessionId: "session-a",
        status: "disagreement",
        disagreementCount: 1,
        actionableCount: 1,
        reportPath: reportPathA,
        recommendationPath: recommendationPathA,
        focusAreaCounts: {
          title: 0,
          summary: 0,
          status: 0,
          intentFrame: 1,
          toolFamily: 0,
          consequence: 0,
          blocking: 0,
          episode: 0,
          confidence: 0,
        },
        recommendationCounts: {
          promote: 1,
          inspect: 0,
          ignore: 0,
        },
        topRecommendations: [],
      },
      {
        sessionId: "session-b",
        status: "disagreement",
        disagreementCount: 1,
        actionableCount: 1,
        reportPath: reportPathB,
        recommendationPath: recommendationPathB,
        focusAreaCounts: {
          title: 0,
          summary: 0,
          status: 0,
          intentFrame: 1,
          toolFamily: 0,
          consequence: 0,
          blocking: 0,
          episode: 0,
          confidence: 0,
        },
        recommendationCounts: {
          promote: 1,
          inspect: 0,
          ignore: 0,
        },
        topRecommendations: [],
      },
    ],
  };
  await writeJson(batchReportPath, batchReport);

  const signals = await collectAutoresearchProposalSignals(batchReportPath, {
    repoRoot,
    minSessionCount: 2,
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.focusArea, "intentFrame");
  assert.equal(signals[0]?.sessionCount, 2);
  assert.equal(signals[0]?.owner, "semantic");
  assert.deepEqual(signals[0]?.sessions, ["session-a", "session-b"]);
});

test("assignAutoresearchProposalSplits reserves validation and heldout for the tail", () => {
  assert.deepEqual(assignAutoresearchProposalSplits(1), ["train"]);
  assert.deepEqual(assignAutoresearchProposalSplits(2), ["train", "heldout"]);
  assert.deepEqual(assignAutoresearchProposalSplits(4), ["train", "train", "validation", "heldout"]);
});

test("determineAutoresearchProposalDiscoveryStatus returns exhausted when no bundles are available", () => {
  const status = determineAutoresearchProposalDiscoveryStatus({
    bundleCount: 0,
    disagreementCount: 0,
    errorCount: 0,
    signalCount: 0,
  });

  assert.equal(status, "exhausted");
});

test("selectAutoresearchProposalPromotions caps the promoted report count", () => {
  const promotions = selectAutoresearchProposalPromotions([
    {
      signature: "intentFrame|semantic|\"failure\"|\"status_update\"",
      focusArea: "intentFrame",
      owner: "semantic",
      apertureValue: "failure",
      expectedValue: "status_update",
      disagreementCount: 3,
      sessionCount: 3,
      sessions: ["a", "b", "c"],
      reportPaths: ["/tmp/a.json", "/tmp/b.json", "/tmp/c.json"],
      targets: ["packages/core/src/semantic-interpreter.ts"],
      confidenceCounts: { high: 3, medium: 0, low: 0 },
      examples: [],
    },
  ], {
    maxReports: 2,
  });

  assert.equal(promotions.length, 2);
  assert.deepEqual(promotions.map((entry) => entry.reportPath), ["/tmp/a.json", "/tmp/b.json"]);
});

test("renderAutoresearchProposalMarkdown summarizes proposal outcomes", () => {
  const markdown = renderAutoresearchProposalMarkdown({
    schemaVersion: 1,
    generatedAt: "2026-03-28T00:00:00.000Z",
    status: "proposed",
    summary: {
      bundleCount: 10,
      cleanCount: 1,
      disagreementBundleCount: 9,
      errorCount: 0,
      actionableCount: 23,
      selectedSignalCount: 2,
      promotedCaseCount: 3,
    },
    artifacts: {
      batchReportPath: "batch.json",
      optimizerRunPath: "optimizer.json",
      optimizerPatchPath: "patch.diff",
    },
    signals: [
      {
        signature: "consequence|semantic|\"high\"|\"medium\"",
        focusArea: "consequence",
        owner: "semantic",
        apertureValue: "high",
        expectedValue: "medium",
        disagreementCount: 5,
        sessionCount: 4,
        sessions: ["a", "b", "c", "d"],
        reportPaths: ["a.json"],
        targets: ["packages/core/src/semantic-interpreter.ts"],
        confidenceCounts: { high: 5, medium: 0, low: 0 },
        examples: [],
      },
    ],
    intentStatements: [
      {
        focusArea: "consequence",
        owner: "semantic",
        statement: "Calibrate semantic consequence handling so repeated high -> medium drift is corrected without changing unrelated invariants.",
        apertureValue: "high",
        expectedValue: "medium",
        sessionCount: 4,
        disagreementCount: 5,
        targets: ["packages/core/src/semantic-interpreter.ts"],
      },
    ],
    codeRecommendations: [
      {
        kind: "patch",
        summary: "Narrow consequence escalation for routine observational failures.",
        recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
        reasons: ["Repeated consequence drift was observed across promoted sessions."],
        targets: ["packages/core/src/semantic-interpreter.ts"],
        patchPath: "patch.diff",
        optimizerStatus: "improved",
        beforeMismatchCount: 6,
        afterMismatchCount: 2,
      },
    ],
    promotions: [],
    optimizer: {
      status: "improved",
      beforeMismatchCount: 6,
      afterMismatchCount: 2,
      beforeInvariantMismatchCount: 0,
      afterInvariantMismatchCount: 0,
      changedFiles: ["packages/core/src/semantic-interpreter.ts"],
      disallowedFiles: [],
    },
    notes: [],
  });

  assert.match(markdown, /Autoresearch Proposal/);
  assert.match(markdown, /Status: proposed/);
  assert.match(markdown, /consequence \(semantic\): high -> medium/);
  assert.match(markdown, /Intent Statements/);
  assert.match(markdown, /Code Recommendations/);
  assert.match(markdown, /patch: patch\.diff/);
});

test("proposal intent and code recommendation builders summarize repeated signal sustainably", () => {
  const signals: AutoresearchProposalSignal[] = [
    {
      signature: "consequence|semantic|\"high\"|\"low\"",
      focusArea: "consequence",
      owner: "semantic",
      apertureValue: "high",
      expectedValue: "low",
      disagreementCount: 3,
      sessionCount: 2,
      sessions: ["a", "b"],
      reportPaths: ["/tmp/a.json"],
      targets: ["packages/core/src/semantic-detection.ts"],
      confidenceCounts: { high: 3, medium: 0, low: 0 },
      examples: [],
    },
  ];

  const intents = buildAutoresearchProposalIntentStatements(signals);
  const recommendations = buildAutoresearchProposalCodeRecommendations({
    signals,
  });

  assert.equal(intents.length, 1);
  assert.match(intents[0]!.statement, /Calibrate semantic consequence handling/);
  assert.deepEqual(intents[0]!.targets, ["packages/core/src/semantic-detection.ts"]);
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0]!.kind, "intent_only");
  assert.match(recommendations[0]!.summary, /No surviving patch artifact/);
});

test("proposal code recommendations prefer harness counts over optimizer self-reports", () => {
  const signals: AutoresearchProposalSignal[] = [
    {
      signature: "intentFrame|semantic|\"failure\"|\"status_update\"",
      focusArea: "intentFrame",
      owner: "semantic",
      apertureValue: "failure",
      expectedValue: "status_update",
      disagreementCount: 4,
      sessionCount: 3,
      sessions: ["a", "b", "c"],
      reportPaths: ["/tmp/a.json"],
      targets: ["packages/core/src/semantic-interpreter.ts"],
      confidenceCounts: { high: 4, medium: 0, low: 0 },
      examples: [],
    },
  ];

  const recommendations = buildAutoresearchProposalCodeRecommendations({
    signals,
    optimizerPatchPath: "patch.diff",
    optimizerRun: {
      schemaVersion: 1,
      generatedAt: "2026-03-28T00:00:00.000Z",
      provider: "openclaw",
      optimizerCommand: "provider:openclaw",
      summary: {
        beforeMismatchCount: 5,
        afterMismatchCount: 3,
        beforeInvariantMismatchCount: 0,
        afterInvariantMismatchCount: 0,
        improved: true,
      },
      artifacts: {
        briefPath: "brief.json",
        beforeReportPath: "before.json",
        afterReportPath: "after.json",
      },
      changes: {
        changedFiles: ["packages/core/src/semantic-interpreter.ts"],
        disallowedFiles: [],
      },
      gates: {
        autoresearchEvaluate: true,
        judgmentBattle: true,
        releaseCheck: false,
      },
      status: "gate_blocked",
      feedback: {
        action: "patched",
        summary: "Narrowed observational failure handling.",
        reasons: ["Patch improved the targeted cluster."],
        recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
        changedFiles: ["packages/core/src/semantic-interpreter.ts"],
        commandsRun: ["pnpm lab:fstop:evaluate", "pnpm release:check"],
        beforeMismatchCount: 5,
        afterMismatchCount: 0,
        judgmentBattle: "pass",
        releaseCheck: "fail",
      },
      notes: [],
    },
  });

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0]!.beforeMismatchCount, 5);
  assert.equal(recommendations[0]!.afterMismatchCount, 3);
  assert.equal(recommendations[0]!.optimizerStatus, "gate_blocked");
  assert.match(
    recommendations[0]!.reasons.join("\n"),
    /Harness evaluation measured mismatches 5 -> 3; optimizer self-report claimed 5 -> 0/,
  );
});

test("determineAutoresearchProposalDiscoveryStatus treats all-error batches as errors", () => {
  assert.equal(
    determineAutoresearchProposalDiscoveryStatus({
      bundleCount: 12,
      disagreementCount: 0,
      errorCount: 12,
      signalCount: 0,
    }),
    "error",
  );
  assert.equal(
    determineAutoresearchProposalDiscoveryStatus({
      bundleCount: 12,
      disagreementCount: 3,
      errorCount: 0,
      signalCount: 0,
    }),
    "no_signal",
  );
  assert.equal(
    determineAutoresearchProposalDiscoveryStatus({
      bundleCount: 12,
      disagreementCount: 0,
      errorCount: 0,
      signalCount: 0,
    }),
    "clean",
  );
  assert.equal(
    determineAutoresearchProposalDiscoveryStatus({
      bundleCount: 12,
      disagreementCount: 0,
      errorCount: 0,
      signalCount: 2,
    }),
    undefined,
  );
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
