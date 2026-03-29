import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  writeAutoresearchServiceStatus,
  type AutoresearchServiceStatus,
} from "../src/index.js";

test("writeAutoresearchServiceStatus persists structured JSON", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-autoresearch-service-"));
  const statusPath = path.join(directory, "status.json");

  const status: AutoresearchServiceStatus = {
    schemaVersion: 1,
    serviceId: "fstop-service-1",
    generatedAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:10:00.000Z",
    phase: "running",
    dataset: "dataclaw",
    split: "train",
    sourceRepo: "/tmp/aperture",
    branch: "codex/autoresearch-corpus",
    commit: "abc123",
    currentOffset: 144,
    limit: 12,
    maxSlices: 6,
    windowCount: 4,
    completedWindows: 1,
    reviewConcurrency: 4,
    restartCount: 1,
    maxRestarts: 3,
    campaignStallThresholdSeconds: 900,
    serviceStallThresholdSeconds: 1200,
    currentCampaignId: "campaign-1",
    currentCampaignRoot: "/tmp/aperture/.aperture/lab/current-campaign",
    currentCampaignStatusPath: "/tmp/aperture/.aperture/lab/current-campaign/status.json",
    currentReportPath: "/tmp/aperture/.aperture/lab/current-campaign/current-report.json",
    currentReportMarkdownPath: "/tmp/aperture/.aperture/lab/current-campaign/current-report.md",
    lastProgressAt: "2026-03-29T00:09:30.000Z",
    note: "Running.",
  };

  await writeAutoresearchServiceStatus(statusPath, status);

  assert.deepEqual(JSON.parse(await readFile(statusPath, "utf8")), status);
});
