import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  preserveAutoresearchSweepLaneArtifacts,
  resolveAutoresearchSweepLanes,
} from "../src/autoresearch-sweep-command.js";

test("resolveAutoresearchSweepLanes expands the pre-release preset", () => {
  assert.deepEqual(resolveAutoresearchSweepLanes({ preset: "pre-release" }), [
    { dataset: "swe-smith", split: "xml", label: "01-swe-smith-xml" },
    { dataset: "open-agent-sessions", split: "approved", label: "02-open-agent-sessions-approved" },
  ]);
});

test("preserveAutoresearchSweepLaneArtifacts keeps only minimal lane outputs", async () => {
  const sourceRepo = await mkdtemp(path.join(os.tmpdir(), "aperture-sweep-source-"));
  const laneRoot = await mkdtemp(path.join(os.tmpdir(), "aperture-sweep-lane-"));

  const serviceRoot = path.join(sourceRepo, ".aperture", "lab", "service");
  const campaignRoot = path.join(sourceRepo, ".aperture", "lab", "campaigns", "campaign-1");
  const runRoot = path.join(campaignRoot, "runs", "run-00-offset-0000");
  const statusPath = path.join(serviceRoot, "status.json");
  const logPath = path.join(serviceRoot, "service.log");
  const reportPath = path.join(runRoot, "report.json");
  const reportMarkdownPath = path.join(runRoot, "report.md");
  const proposalPath = path.join(runRoot, "proposal.json");
  const proposalMarkdownPath = path.join(runRoot, "proposal.md");
  const patchPath = path.join(runRoot, "patch.diff");
  const campaignStatusPath = path.join(campaignRoot, "status.json");
  const campaignLogPath = path.join(campaignRoot, "campaign.log");
  const campaignSummaryPath = path.join(campaignRoot, "summary.jsonl");

  for (const [filePath, contents] of [
    [statusPath, "{}\n"],
    [logPath, "service log\n"],
    [reportPath, "{\"status\":\"completed\"}\n"],
    [reportMarkdownPath, "# Report\n"],
    [proposalPath, "{\"status\":\"proposed\"}\n"],
    [proposalMarkdownPath, "# Proposal\n"],
    [patchPath, "diff --git a/foo b/foo\n"],
    [campaignStatusPath, "{}\n"],
    [campaignLogPath, "campaign log\n"],
    [campaignSummaryPath, "{\"runIndex\":0}\n"],
  ] as const) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }

  const preserved = await preserveAutoresearchSweepLaneArtifacts({
    laneRoot,
    sourceRepo,
    result: {
      serviceRoot,
      statusPath,
      logPath,
      currentReportPath: reportPath,
      currentReportMarkdownPath: reportMarkdownPath,
      selectedProposalPath: proposalPath,
      selectedPatchPath: patchPath,
    },
  });

  assert.equal(await readFile(preserved.serviceStatusPath!, "utf8"), "{}\n");
  assert.equal(await readFile(preserved.serviceLogPath!, "utf8"), "service log\n");
  assert.equal(await readFile(preserved.reportMarkdownPath!, "utf8"), "# Report\n");
  assert.equal(await readFile(preserved.proposalMarkdownPath!, "utf8"), "# Proposal\n");
  assert.equal(await readFile(preserved.patchPath!, "utf8"), "diff --git a/foo b/foo\n");
  assert.equal(await readFile(preserved.campaignLogPath!, "utf8"), "campaign log\n");
  assert.equal(await readFile(preserved.campaignSummaryPath!, "utf8"), "{\"runIndex\":0}\n");
});
