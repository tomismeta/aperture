import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendAutoresearchCampaignSummary,
  calculateAutoresearchCampaignPercent,
  calculateAutoresearchWindowPercent,
  calculateAutoresearchWindowPercentIncludingInflight,
  writeAutoresearchCampaignStatus,
  writeAutoresearchRunStatusSnapshot,
  type AutoresearchCampaignStatus,
  type AutoresearchRunStatusSnapshot,
} from "../src/index.js";

test("calculateAutoresearchWindowPercent clamps progress", () => {
  assert.equal(calculateAutoresearchWindowPercent(0, 10), 0);
  assert.equal(calculateAutoresearchWindowPercent(5, 10), 50);
  assert.equal(calculateAutoresearchWindowPercent(12, 10), 100);
  assert.equal(calculateAutoresearchWindowPercent(1, 0), 100);
});

test("calculateAutoresearchWindowPercentIncludingInflight counts an active slice", () => {
  assert.equal(calculateAutoresearchWindowPercentIncludingInflight(0, 10, false), 0);
  assert.equal(calculateAutoresearchWindowPercentIncludingInflight(0, 10, true), 10);
  assert.equal(calculateAutoresearchWindowPercentIncludingInflight(9, 10, true), 100);
});

test("calculateAutoresearchCampaignPercent includes current window progress", () => {
  assert.equal(
    calculateAutoresearchCampaignPercent({
      completedWindows: 0,
      windowCount: 8,
      currentWindowPercent: 10,
    }),
    1,
  );
  assert.equal(
    calculateAutoresearchCampaignPercent({
      completedWindows: 3,
      windowCount: 8,
      currentWindowPercent: 50,
    }),
    44,
  );
  assert.equal(
    calculateAutoresearchCampaignPercent({
      completedWindows: 8,
      windowCount: 8,
      currentWindowPercent: 0,
    }),
    100,
  );
});

test("writeAutoresearchCampaignStatus and run snapshot persist structured JSON", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-autoresearch-campaign-"));
  const statusPath = path.join(directory, "status.json");
  const runStatusPath = path.join(directory, "run-status.json");

  const campaignStatus: AutoresearchCampaignStatus = {
    schemaVersion: 1,
    campaignId: "campaign-1",
    generatedAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
    lastProgressAt: "2026-03-29T00:00:30.000Z",
    phase: "running",
    dataset: "dataclaw",
    split: "train",
    branch: "codex/autoresearch-corpus",
    commit: "abc123",
    offset: 12,
    limit: 12,
    maxSlices: 10,
    windowCount: 8,
    completedWindows: 1,
    campaignPercent: 13,
    reviewConcurrency: 3,
    stallThresholdSeconds: 900,
    stalled: false,
    runIndex: 1,
    runId: "run-01-offset-0012",
    currentReportPath: "/tmp/aperture/.aperture/lab/current-campaign/current-report.json",
    currentReportMarkdownPath: "/tmp/aperture/.aperture/lab/current-campaign/current-report.md",
    currentRunProgress: {
      phase: "running",
      attemptedSlices: 2,
      completedSlices: 1,
      remainingSlices: 8,
      windowPercent: 10,
      windowPercentIncludingInflight: 20,
      lastProgressAt: "2026-03-29T00:00:30.000Z",
      heartbeatAgeSeconds: 5,
      currentSliceStartedAt: "2026-03-29T00:00:20.000Z",
      activeSliceElapsedSeconds: 10,
    },
  };
  const runStatus: AutoresearchRunStatusSnapshot = {
    schemaVersion: 1,
    generatedAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
    lastProgressAt: "2026-03-29T00:00:30.000Z",
    phase: "running",
    dataset: "dataclaw",
    split: "train",
    provider: "openclaw",
    reviewerProvider: "openclaw",
    optimizerProvider: "openclaw",
    reviewConcurrency: 3,
    offset: 12,
    limit: 12,
    maxSlices: 10,
    attemptedSlices: 2,
    completedSlices: 1,
    remainingSlices: 8,
    windowPercent: 10,
    windowPercentIncludingInflight: 20,
    currentSlice: {
      index: 1,
      offset: 24,
      limit: 12,
    },
    currentSliceStartedAt: "2026-03-29T00:00:20.000Z",
    activeSliceElapsedSeconds: 10,
  };

  await writeAutoresearchCampaignStatus(statusPath, campaignStatus);
  await writeAutoresearchRunStatusSnapshot(runStatusPath, runStatus);

  assert.deepEqual(JSON.parse(await readFile(statusPath, "utf8")), campaignStatus);
  assert.deepEqual(JSON.parse(await readFile(runStatusPath, "utf8")), runStatus);
});

test("appendAutoresearchCampaignSummary appends JSONL rows", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-autoresearch-campaign-log-"));
  const filePath = path.join(directory, "summary.jsonl");

  await appendAutoresearchCampaignSummary(filePath, {
    runIndex: 0,
    runId: "run-00-offset-0000",
    startOffset: 0,
    finishedAt: "2026-03-29T00:00:00.000Z",
    branch: "codex/autoresearch-corpus",
    commit: "abc123",
    status: "no_proposal",
    runPath: "run-0.json",
  });
  await appendAutoresearchCampaignSummary(filePath, {
    runIndex: 1,
    runId: "run-01-offset-0120",
    startOffset: 120,
    finishedAt: "2026-03-29T01:00:00.000Z",
    branch: "codex/autoresearch-corpus",
    commit: "abc123",
    status: "proposal_ready",
    runPath: "run-1.json",
    selectedPatchPath: "patch.diff",
  });

  const contents = await readFile(filePath, "utf8");
  const lines = contents.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]!).runId, "run-00-offset-0000");
  assert.equal(JSON.parse(lines[1]!).status, "proposal_ready");
});
