import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createSessionBundleFromDataclawRow,
  renderAutoresearchFinalReportMarkdown,
  synthesizeAutoresearchFinalReport,
  writeSessionBundle,
  type AutoresearchOptimizerRun,
  type AutoresearchProposalRun,
  type AutoresearchRunnerRun,
  type DataclawRow,
  type OfflineReviewBatchReport,
} from "../src/index.js";

const SAMPLE_DATACLAW_ROW: DataclawRow = {
  session_id: "123e4567-e89b-12d3-a456-426614174000",
  source: "claude",
  project: "demo-project",
  model: "claude-sonnet-4",
  start_time: "2026-03-28T00:00:00.000Z",
  messages: [
    {
      role: "user",
      content: "Add retry logic to @src/client.ts and explain the fix.",
      timestamp: "2026-03-28T00:00:10.000Z",
    },
    {
      role: "assistant",
      content: "I'll inspect the client implementation first.",
      timestamp: "2026-03-28T00:00:20.000Z",
    },
    {
      role: "assistant",
      timestamp: "2026-03-28T00:00:30.000Z",
      tool_uses: [
        {
          tool: "Read",
          input: { file_path: "/workspace/src/client.ts" },
          output: { text: "1 export async function request() {\n2 return fetch('/api');\n3 }" },
          status: "success",
        },
      ],
    },
    {
      role: "assistant",
      content: "I added bounded retry logic and preserved the timeout behavior.",
      timestamp: "2026-03-28T00:02:00.000Z",
    },
  ],
};

test("synthesizeAutoresearchFinalReport combines proposal, optimizer, and bundle coverage", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aperture-autoresearch-report-"));
  const bundlesDir = path.join(repoRoot, "bundles");
  const reportsDir = path.join(repoRoot, "reports");
  await mkdir(bundlesDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });

  const bundle = createSessionBundleFromDataclawRow(SAMPLE_DATACLAW_ROW);
  const bundlePath = path.join(bundlesDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const batchReportPath = path.join(reportsDir, "batch.json");
  const optimizerRunPath = path.join(reportsDir, "optimizer.json");
  const proposalPath = path.join(reportsDir, "proposal.json");
  const runnerRunPath = path.join(reportsDir, "runner.json");

  const batchReport: OfflineReviewBatchReport = {
    schemaVersion: 1,
    generatedAt: "2026-03-29T00:00:00.000Z",
    reviewer: {
      provider: "openclaw",
      command: "pnpm lab:fstop:reviewer --provider openclaw",
    },
    input: {
      imported: true,
      bundles: [bundlePath],
    },
    summary: {
      bundleCount: 1,
      statusCounts: { clean: 0, disagreement: 1, error: 0 },
      disagreementCount: 2,
      actionableCount: 2,
      focusAreaCounts: {
        title: 0,
        summary: 0,
        status: 1,
        intentFrame: 0,
        toolFamily: 0,
        consequence: 1,
      },
      recommendationCounts: { promote: 2, inspect: 0, ignore: 0 },
    },
    entries: [],
  };

  const optimizerRun: AutoresearchOptimizerRun = {
    schemaVersion: 1,
    generatedAt: "2026-03-29T00:05:00.000Z",
    provider: "openclaw",
    optimizerCommand: "pnpm lab:fstop:optimizer --provider openclaw",
    summary: {
      beforeMismatchCount: 2,
      afterMismatchCount: 0,
      beforeInvariantMismatchCount: 0,
      afterInvariantMismatchCount: 0,
      improved: true,
    },
    artifacts: {
      briefPath: "brief.json",
      beforeReportPath: "before.json",
      afterReportPath: "after.json",
      patchPath: "patch.diff",
    },
    changes: {
      changedFiles: ["packages/core/src/semantic-interpreter.ts"],
      disallowedFiles: [],
    },
    gates: {
      autoresearchEvaluate: true,
      judgmentBattle: true,
      releaseCheck: true,
    },
    status: "improved",
    feedback: {
      action: "patched",
      summary: "Reduced mismatches with a bounded semantic patch.",
      reasons: ["Repeated consequence inflation on observational failures."],
      recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
      changedFiles: ["packages/core/src/semantic-interpreter.ts"],
      commandsRun: ["pnpm lab:fstop:evaluate --json"],
      beforeMismatchCount: 2,
      afterMismatchCount: 0,
      judgmentBattle: "pass",
      releaseCheck: "pass",
    },
    notes: ["Optimizer left a durable patch."],
  };

  const proposal: AutoresearchProposalRun = {
    schemaVersion: 1,
    generatedAt: "2026-03-29T00:04:00.000Z",
    status: "proposed",
    summary: {
      bundleCount: 1,
      cleanCount: 0,
      disagreementBundleCount: 1,
      errorCount: 0,
      actionableCount: 2,
      selectedSignalCount: 1,
      promotedCaseCount: 1,
    },
    artifacts: {
      batchReportPath,
      optimizerRunPath,
      optimizerPatchPath: "patch.diff",
    },
    signals: [
      {
        signature: "consequence|semantic|high|low",
        focusArea: "consequence",
        owner: "semantic",
        apertureValue: "high",
        expectedValue: "low",
        disagreementCount: 2,
        sessionCount: 1,
        sessions: [bundle.sessionId],
        reportPaths: ["report.json"],
        targets: ["packages/core/src/semantic-interpreter.ts"],
        confidenceCounts: { high: 2, medium: 0, low: 0 },
        examples: [],
      },
    ],
    intentStatements: [
      {
        focusArea: "consequence",
        owner: "semantic",
        statement: "Lower consequence for routine observational failures that still deliver evidence.",
        apertureValue: "high",
        expectedValue: "low",
        sessionCount: 1,
        disagreementCount: 2,
        targets: ["packages/core/src/semantic-interpreter.ts"],
      },
    ],
    codeRecommendations: [
      {
        kind: "patch",
        summary: "Narrow the failure semantics for observational read/search outputs.",
        recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
        reasons: ["Repeated signal on observational failures."],
        targets: ["packages/core/src/semantic-interpreter.ts"],
        patchPath: "patch.diff",
        optimizerStatus: "improved",
        beforeMismatchCount: 2,
        afterMismatchCount: 0,
      },
    ],
    promotions: [],
    optimizer: {
      status: "improved",
      beforeMismatchCount: 2,
      afterMismatchCount: 0,
      beforeInvariantMismatchCount: 0,
      afterInvariantMismatchCount: 0,
      changedFiles: ["packages/core/src/semantic-interpreter.ts"],
      disallowedFiles: [],
    },
    notes: ["Proposal selected from unseen DataClaw slice."],
  };

  const runnerRun: AutoresearchRunnerRun = {
    schemaVersion: 1,
    generatedAt: "2026-03-29T00:06:00.000Z",
    provider: "openclaw",
    runnerCommand: "deterministic sequential slice loop",
    status: "proposal_ready",
    artifacts: {
      selectedProposalPath: proposalPath,
      selectedBatchReportPath: batchReportPath,
      selectedOptimizerRunPath: optimizerRunPath,
      selectedPatchPath: "patch.diff",
    },
    selectedProposal: {
      status: "proposed",
      summary: {
        actionableCount: 2,
        selectedSignalCount: 1,
        promotedCaseCount: 1,
      },
      intentStatements: proposal.intentStatements,
      codeRecommendations: proposal.codeRecommendations,
    },
    feedback: {
      action: "proposal_ready",
      summary: "Selected the patch-producing slice.",
      reasons: ["Slice 0 produced a durable patch artifact."],
      commandsRun: ["pnpm lab:fstop:propose --offset 0 --limit 12 --json"],
      attempts: [
        {
          offset: 0,
          limit: 12,
          status: "proposed",
          actionableCount: 2,
          selectedSignalCount: 1,
          promotedCaseCount: 1,
          optimizerStatus: "improved",
          proposalPath,
          batchReportPath,
          optimizerRunPath,
          optimizerPatchPath: "patch.diff",
        },
      ],
      selectedProposalPath: proposalPath,
      selectedBatchReportPath: batchReportPath,
      selectedOptimizerRunPath: optimizerRunPath,
      selectedPatchPath: "patch.diff",
    },
    notes: ["Runner stopped after the first successful proposal."],
  };

  await writeJson(batchReportPath, batchReport);
  await writeJson(optimizerRunPath, optimizerRun);
  await writeJson(proposalPath, proposal);
  await writeJson(runnerRunPath, runnerRun);

  const report = await synthesizeAutoresearchFinalReport({
    runnerRunPath,
    repoRoot,
  });

  assert.equal(report.status, "proposed");
  assert.equal(report.runSummary.bundleCount, 1);
  assert.equal(report.runSummary.sessionCount, 1);
  assert.ok(report.runSummary.replayStepCount > 0);
  assert.equal(report.majorDisagreements.length, 1);
  assert.match(report.recommendation, /Review the proposed patch/i);

  const markdown = renderAutoresearchFinalReportMarkdown(report);
  assert.match(markdown, /Aperture Lab F-Stop Report/);
  assert.match(markdown, /replay steps:/);
  assert.match(markdown, /Major Disagreements/);
  assert.match(markdown, /Lower consequence for routine observational failures/);
});

test("synthesizeAutoresearchFinalReport aggregates coverage from no-proposal attempts", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aperture-autoresearch-report-no-proposal-"));
  const bundlesDir = path.join(repoRoot, "bundles");
  const reportsDir = path.join(repoRoot, "reports");
  await mkdir(bundlesDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });

  const bundleA = createSessionBundleFromDataclawRow(SAMPLE_DATACLAW_ROW);
  const bundleB = createSessionBundleFromDataclawRow({
    ...SAMPLE_DATACLAW_ROW,
    session_id: "223e4567-e89b-12d3-a456-426614174000",
    start_time: "2026-03-28T01:00:00.000Z",
  });
  const bundlePathA = path.join(bundlesDir, "bundle-a.json");
  const bundlePathB = path.join(bundlesDir, "bundle-b.json");
  await writeSessionBundle(bundlePathA, bundleA);
  await writeSessionBundle(bundlePathB, bundleB);

  const batchPathA = path.join(reportsDir, "batch-a.json");
  const batchPathB = path.join(reportsDir, "batch-b.json");
  const proposalPathA = path.join(reportsDir, "proposal-a.json");
  const proposalPathB = path.join(reportsDir, "proposal-b.json");
  const runnerRunPath = path.join(reportsDir, "runner.json");

  const batchA: OfflineReviewBatchReport = {
    schemaVersion: 1,
    generatedAt: "2026-03-29T00:10:00.000Z",
    reviewer: { provider: "openclaw", command: "pnpm lab:fstop:reviewer --provider openclaw" },
    input: { imported: true, bundles: [bundlePathA] },
    summary: {
      bundleCount: 1,
      statusCounts: { clean: 1, disagreement: 0, error: 0 },
      disagreementCount: 0,
      actionableCount: 0,
      focusAreaCounts: {
        title: 0,
        summary: 0,
        status: 0,
        intentFrame: 0,
        toolFamily: 0,
        consequence: 0,
      },
      recommendationCounts: { promote: 0, inspect: 0, ignore: 1 },
    },
    entries: [],
  };
  const batchB: OfflineReviewBatchReport = {
    ...batchA,
    input: { imported: true, bundles: [bundlePathB] },
  };

  const cleanProposal = (batchReportPath: string): AutoresearchProposalRun => ({
    schemaVersion: 1,
    generatedAt: "2026-03-29T00:11:00.000Z",
    status: "clean",
    summary: {
      bundleCount: 1,
      cleanCount: 1,
      disagreementBundleCount: 0,
      errorCount: 0,
      actionableCount: 0,
      selectedSignalCount: 0,
      promotedCaseCount: 0,
    },
    artifacts: {
      batchReportPath,
    },
    signals: [],
    intentStatements: [],
    codeRecommendations: [],
    promotions: [],
    notes: [],
  });

  const runnerRun: AutoresearchRunnerRun = {
    schemaVersion: 1,
    generatedAt: "2026-03-29T00:12:00.000Z",
    provider: "openclaw",
    runnerCommand: "deterministic sequential slice loop",
    status: "no_proposal",
    artifacts: {},
    feedback: {
      action: "no_proposal",
      summary: "Exhausted the slice budget without finding a proposal patch artifact.",
      reasons: ["2 attempt(s) ended with status=clean."],
      commandsRun: [],
      attempts: [
        {
          offset: 0,
          limit: 12,
          status: "clean",
          actionableCount: 0,
          selectedSignalCount: 0,
          promotedCaseCount: 0,
          proposalPath: proposalPathA,
        },
        {
          offset: 12,
          limit: 12,
          status: "clean",
          actionableCount: 0,
          selectedSignalCount: 0,
          promotedCaseCount: 0,
          proposalPath: proposalPathB,
        },
      ],
    },
    notes: [],
  };

  await writeJson(batchPathA, batchA);
  await writeJson(batchPathB, batchB);
  await writeJson(proposalPathA, cleanProposal(batchPathA));
  await writeJson(proposalPathB, cleanProposal(batchPathB));
  await writeJson(runnerRunPath, runnerRun);

  const report = await synthesizeAutoresearchFinalReport({
    runnerRunPath,
    repoRoot,
  });

  assert.equal(report.status, "no_proposal");
  assert.equal(report.runSummary.bundleCount, 2);
  assert.equal(report.runSummary.sessionCount, 2);
  assert.ok(report.runSummary.replayStepCount > 0);
  assert.equal(report.runSummary.cleanCount, 2);
  assert.equal(report.attempts.length, 2);
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
