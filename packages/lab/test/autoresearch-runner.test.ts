import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultAutoresearchRunnerRunPath,
  renderAutoresearchRunnerRunMarkdown,
  type AutoresearchRunnerRun,
} from "../src/index.js";

test("renderAutoresearchRunnerRunMarkdown summarizes the sequential run clearly", () => {
  const run: AutoresearchRunnerRun = {
    schemaVersion: 1,
    generatedAt: "2026-03-28T00:00:00.000Z",
    provider: "openclaw",
    runnerCommand: "deterministic sequential slice loop",
    status: "proposal_ready",
    artifacts: {
      selectedProposalPath: ".aperture/lab/results/autoresearch/proposals/example.json",
      selectedBatchReportPath: ".aperture/lab/results/offline-review/batches/example.json",
      selectedOptimizerRunPath: ".aperture/lab/results/autoresearch/optimizer/runs/example.json",
      selectedPatchPath: ".aperture/lab/results/autoresearch/optimizer/patches/example.diff",
    },
    feedback: {
      action: "proposal_ready",
      summary: "Found a proposal on the first patch-producing slice.",
      reasons: ["Offset 24 produced a durable patch artifact."],
      commandsRun: [
        "pnpm lab:fstop:propose --dataset swe-smith --split tool --offset 24 --limit 12 --json",
      ],
      attempts: [
        {
          offset: 24,
          limit: 12,
          status: "proposed",
          proposalPath: ".aperture/lab/results/autoresearch/proposals/example.json",
          optimizerPatchPath: ".aperture/lab/results/autoresearch/optimizer/patches/example.diff",
        },
      ],
      selectedProposalPath: ".aperture/lab/results/autoresearch/proposals/example.json",
      selectedPatchPath: ".aperture/lab/results/autoresearch/optimizer/patches/example.diff",
    },
    notes: ["Sequential slice loop stopped after the first successful patch."],
  };

  const markdown = renderAutoresearchRunnerRunMarkdown(run);

  assert.match(markdown, /Aperture Lab F-Stop Run/);
  assert.match(markdown, /Execution: deterministic sequential slice loop/);
  assert.match(markdown, /Status: proposal_ready/);
  assert.match(markdown, /selected proposal/);
  assert.match(markdown, /Commands/);
  assert.match(markdown, /example\.diff/);
  assert.match(markdown, /Sequential slice loop stopped after the first successful patch/);
});

test("defaultAutoresearchRunnerRunPath writes run artifacts under the runner runs dir", () => {
  const filePath = defaultAutoresearchRunnerRunPath("2026-03-28T00:00:00.000Z");
  assert.match(filePath, /\.aperture\/lab\/results\/autoresearch\/runner\/runs\/autoresearch-runner-run-2026-03-28T00-00-00-000Z\.json$/);
});
