import assert from "node:assert/strict";
import test from "node:test";

import type { AutoresearchProposalRun } from "../src/autoresearch-proposal.js";
import { projectAutoresearchProposalSnapshot } from "../src/autoresearch-proposal-snapshot.js";

test("projectAutoresearchProposalSnapshot preserves the retained review surface", () => {
  const proposal: AutoresearchProposalRun = {
    schemaVersion: 1,
    generatedAt: "2026-03-31T00:00:00.000Z",
    status: "no_change",
    summary: {
      bundleCount: 2,
      cleanCount: 0,
      disagreementBundleCount: 2,
      errorCount: 0,
      actionableCount: 4,
      selectedSignalCount: 1,
      promotedCaseCount: 2,
    },
    artifacts: {
      batchReportPath: "batch.json",
      optimizerRunPath: "optimizer.json",
      optimizerPatchPath: "patch.diff",
    },
    signals: [
      {
        signature: "consequence|semantic|low|medium|semantic-interpreter",
        focusArea: "consequence",
        owner: "semantic",
        apertureValue: "low",
        expectedValue: "medium",
        disagreementCount: 3,
        sessionCount: 2,
        sessions: ["session-a", "session-b"],
        reportPaths: ["report-a.json", "report-b.json"],
        targets: ["packages/core/src/semantic-interpreter.ts"],
        confidenceCounts: { high: 2, medium: 1, low: 0 },
        examples: [
          {
            sessionId: "session-a",
            stepIndex: 4,
            stepLabel: "step-a",
            confidence: "high",
            rationale: "Unresolved completion should stay visible.",
          },
          {
            sessionId: "session-b",
            stepIndex: 9,
            confidence: "medium",
          },
        ],
      },
    ],
    intentStatements: [
      {
        focusArea: "consequence",
        owner: "semantic",
        statement: "Raise unresolved completion consequence when the summary is still open-ended.",
        apertureValue: "low",
        expectedValue: "medium",
        sessionCount: 2,
        disagreementCount: 3,
        targets: ["packages/core/src/semantic-interpreter.ts"],
      },
    ],
    codeRecommendations: [
      {
        kind: "patch",
        summary: "Route unresolved completions back through semantic consequence inference.",
        recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
        reasons: ["Repeated low -> medium drift on unresolved terminal summaries."],
        targets: ["packages/core/src/semantic-interpreter.ts"],
        patchPath: "patch.diff",
        optimizerStatus: "no_change",
        beforeMismatchCount: 3,
        afterMismatchCount: 3,
      },
    ],
    promotions: [],
    optimizer: {
      status: "no_change",
      beforeMismatchCount: 3,
      afterMismatchCount: 3,
      beforeInvariantMismatchCount: 0,
      afterInvariantMismatchCount: 0,
      changedFiles: ["packages/core/src/semantic-interpreter.ts"],
      disallowedFiles: [],
      judgmentBattle: true,
      releaseCheck: false,
      patchPath: "patch.diff",
    },
    notes: [],
  };

  assert.deepEqual(projectAutoresearchProposalSnapshot(proposal), {
    status: "no_change",
    summary: {
      actionableCount: 4,
      selectedSignalCount: 1,
      promotedCaseCount: 2,
    },
    signals: [
      {
        signature: "consequence|semantic|low|medium|semantic-interpreter",
        focusArea: "consequence",
        owner: "semantic",
        apertureValue: "low",
        expectedValue: "medium",
        sessionCount: 2,
        disagreementCount: 3,
        targets: ["packages/core/src/semantic-interpreter.ts"],
        examples: [
          {
            sessionId: "session-a",
            stepIndex: 4,
            stepLabel: "step-a",
            confidence: "high",
            rationale: "Unresolved completion should stay visible.",
          },
          {
            sessionId: "session-b",
            stepIndex: 9,
            confidence: "medium",
          },
        ],
      },
    ],
    optimizer: {
      status: "no_change",
      beforeMismatchCount: 3,
      afterMismatchCount: 3,
      beforeInvariantMismatchCount: 0,
      afterInvariantMismatchCount: 0,
      changedFiles: ["packages/core/src/semantic-interpreter.ts"],
      disallowedFiles: [],
      judgmentBattle: true,
      releaseCheck: false,
      patchPath: "patch.diff",
    },
    intentStatements: [
      {
        focusArea: "consequence",
        owner: "semantic",
        statement: "Raise unresolved completion consequence when the summary is still open-ended.",
        apertureValue: "low",
        expectedValue: "medium",
        sessionCount: 2,
        disagreementCount: 3,
        targets: ["packages/core/src/semantic-interpreter.ts"],
      },
    ],
    codeRecommendations: [
      {
        kind: "patch",
        summary: "Route unresolved completions back through semantic consequence inference.",
        recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
        reasons: ["Repeated low -> medium drift on unresolved terminal summaries."],
        targets: ["packages/core/src/semantic-interpreter.ts"],
        patchPath: "patch.diff",
        optimizerStatus: "no_change",
        beforeMismatchCount: 3,
        afterMismatchCount: 3,
      },
    ],
  });
});
