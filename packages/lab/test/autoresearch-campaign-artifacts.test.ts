import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  finalizeCampaignRunArtifacts,
  type CampaignRunArtifactPayload,
} from "../src/autoresearch-campaign-artifacts.js";
import type { AutoresearchFinalReport } from "../src/autoresearch-report.js";

test("finalizeCampaignRunArtifacts preserves minimal outputs and removes transient files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-campaign-artifacts-"));
  const sourceRepo = path.join(root, "source");
  const runRoot = path.join(root, "campaign", "runs", "run-00-offset-0000");
  const repoDir = path.join(runRoot, "repo");
  const outputPath = path.join(runRoot, "output.json");
  const runStatusPath = path.join(runRoot, "status.json");
  const reportPath = path.join(runRoot, "report.json");
  const reportMarkdownPath = path.join(runRoot, "report.md");
  const runnerRunPath = ".aperture/lab/results/autoresearch/runner/runs/run.json";
  const runnerRunMarkdownPath = ".aperture/lab/results/autoresearch/runner/runs/run.md";
  const proposalPath = ".aperture/lab/results/autoresearch/proposals/proposal.json";
  const patchPath = ".aperture/lab/results/autoresearch/optimizer/patches/patch.diff";

  const payload: CampaignRunArtifactPayload = {
    runPath: runnerRunPath,
    runMarkdownPath: runnerRunMarkdownPath,
    selectedProposalPath: proposalPath,
    selectedPatchPath: patchPath,
  };

  await mkdir(path.dirname(path.join(repoDir, runnerRunPath)), { recursive: true });
  await mkdir(path.dirname(path.join(repoDir, proposalPath)), { recursive: true });
  await mkdir(path.dirname(path.join(repoDir, patchPath)), { recursive: true });
  await mkdir(sourceRepo, { recursive: true });
  await writeFile(path.join(repoDir, runnerRunPath), "{\n  \"status\": \"no_proposal\"\n}\n", "utf8");
  await writeFile(path.join(repoDir, runnerRunMarkdownPath), "# Runner\n", "utf8");
  await writeFile(path.join(repoDir, proposalPath), "{\n  \"status\": \"proposed\"\n}\n", "utf8");
  await writeFile(
    path.join(repoDir, proposalPath).replace(/\.json$/i, ".md"),
    "# Proposal\n",
    "utf8",
  );
  await writeFile(path.join(repoDir, patchPath), "diff --git a/example b/example\n", "utf8");
  await writeFile(outputPath, "{\n  \"status\": \"proposal_ready\"\n}\n", "utf8");
  await writeFile(runStatusPath, "{\n  \"phase\": \"completed\"\n}\n", "utf8");

  const report: AutoresearchFinalReport = {
    schemaVersion: 1,
    generatedAt: "2026-03-29T00:00:00.000Z",
    status: "proposed",
    recommendation: "Review the preserved proposal and patch.",
    source: {
      runnerRunPath,
      proposalPath,
      batchReportPath: ".aperture/lab/results/offline-review/batches/batch.json",
      optimizerRunPath: ".aperture/lab/results/autoresearch/optimizer/runs/optimizer.json",
      patchPath,
    },
    runSummary: {
      bundleCount: 1,
      sessionCount: 1,
      replayStepCount: 12,
      sourceEventStepCount: 8,
      submitStepCount: 1,
      actionableCount: 2,
      selectedSignalCount: 1,
      promotedCaseCount: 1,
    },
    majorDisagreements: [
      {
        focusArea: "consequence",
        owner: "semantic",
        apertureValue: "high",
        expectedValue: "low",
        sessionCount: 1,
        disagreementCount: 2,
        targets: ["packages/core/src/semantic-detection.ts"],
      },
    ],
    attempts: [
      {
        offset: 0,
        limit: 12,
        status: "proposed",
        actionableCount: 2,
        selectedSignalCount: 1,
        promotedCaseCount: 1,
      },
    ],
    intentStatements: [],
    codeRecommendations: [
      {
        kind: "patch",
        summary: "Lower consequence for routine observational failures.",
        recommendedFiles: ["packages/core/src/semantic-detection.ts"],
        reasons: ["Repeated disagreements across the slice."],
        targets: ["packages/core/src/semantic-detection.ts"],
        patchPath,
      },
    ],
    notes: [],
  };

  const preserved = await finalizeCampaignRunArtifacts({
    sourceRepo,
    runRoot,
    repoDir,
    outputPath,
    runStatusPath,
    payload,
    report,
    reportPath,
    reportMarkdownPath,
    cleanupWorkspace: async () => {
      await rm(repoDir, { recursive: true, force: true });
    },
  });

  assert.equal(preserved.reportPath, reportPath);
  assert.equal(preserved.reportMarkdownPath, reportMarkdownPath);
  assert.equal(preserved.runPath, path.join(runRoot, "runner-run.json"));
  assert.equal(preserved.runMarkdownPath, path.join(runRoot, "runner-run.md"));
  assert.equal(preserved.selectedProposalPath, path.join(runRoot, "proposal.json"));
  assert.equal(preserved.selectedProposalMarkdownPath, path.join(runRoot, "proposal.md"));
  assert.equal(preserved.selectedPatchPath, path.join(runRoot, "patch.diff"));

  const persistedReport = JSON.parse(await readFile(reportPath, "utf8")) as AutoresearchFinalReport;
  assert.equal(persistedReport.source.runnerRunPath, path.join(runRoot, "runner-run.json"));
  assert.equal(persistedReport.source.proposalPath, path.join(runRoot, "proposal.json"));
  assert.equal(persistedReport.source.patchPath, path.join(runRoot, "patch.diff"));
  assert.equal("batchReportPath" in persistedReport.source, false);
  assert.equal("optimizerRunPath" in persistedReport.source, false);
  assert.equal(persistedReport.codeRecommendations[0]?.patchPath, path.join(runRoot, "patch.diff"));
  assert.ok(
    persistedReport.notes.includes("Transient worktree artifacts were deleted after report synthesis."),
  );

  const markdown = await readFile(reportMarkdownPath, "utf8");
  assert.match(markdown, /Aperture Lab F-Stop Report/);
  assert.match(markdown, /Transient worktree artifacts were deleted after report synthesis/);

  await assert.rejects(access(repoDir));
  await assert.rejects(access(outputPath));
  await assert.rejects(access(runStatusPath));
  assert.equal(await readFile(path.join(runRoot, "proposal.md"), "utf8"), "# Proposal\n");
});
