import assert from "node:assert/strict";
import test from "node:test";

import {
  appendAutoresearchOptimizerResultsLog,
  assessAutoresearchEditSurface,
  defaultAutoresearchOptimizerPatchPath,
  renderAutoresearchOptimizationPrompt,
  renderAutoresearchOptimizerRunMarkdown,
  type AutoresearchOptimizationBrief,
  type AutoresearchOptimizerRun,
} from "../src/index.js";

test("renderAutoresearchOptimizationPrompt points the optimizer at the bounded surface", () => {
  const brief: AutoresearchOptimizationBrief = {
    schemaVersion: 1,
    generatedAt: "2026-03-28T00:00:00.000Z",
    reportPath: "packages/lab/results/autoresearch/evaluations/example.json",
    summary: {
      caseCount: 2,
      expectationCount: 32,
      mismatchCount: 5,
      correctedMismatchCount: 5,
      invariantMismatchCount: 0,
    },
    priorities: [
      {
        focusArea: "intentFrame",
        targets: ["packages/core/src/semantic-interpreter.ts"],
        mismatchCount: 3,
        correctedMismatchCount: 3,
        invariantMismatchCount: 0,
        sessions: ["session-1"],
        examples: [
          {
            sessionId: "session-1",
            stepIndex: 10,
            stepLabel: "tool:observation",
            mode: "corrected",
            expectedValue: "status_update",
            currentValue: "failure",
            confidence: "high",
          },
        ],
      },
    ],
    allowedEditPaths: [
      "packages/core/src/semantic-interpreter.ts",
      "packages/core/src/semantic-detection.ts",
    ],
    evaluationCommands: [
      "pnpm lab:autoresearch:evaluate",
      "pnpm judgment:battle",
    ],
    guidance: [
      "Reduce corrected mismatches first.",
    ],
  };

  const prompt = renderAutoresearchOptimizationPrompt(brief);

  assert.match(prompt, /Aperture Autoresearch Optimization Task/);
  assert.match(prompt, /skills\/aperture-lab-optimizer\/SKILL.md/);
  assert.match(prompt, /packages\/core\/src\/semantic-interpreter\.ts/);
  assert.match(prompt, /pnpm judgment:battle/);
  assert.match(prompt, /failure -> status_update/);
});

test("assessAutoresearchEditSurface rejects files outside the allowed surface", () => {
  const result = assessAutoresearchEditSurface(
    [
      "./packages/core/src/semantic-interpreter.ts",
      "packages/tui/src/render.ts",
      "packages/core/src/semantic-interpreter.ts",
    ],
    [
      "packages/core/src/semantic-interpreter.ts",
      "packages/core/src/semantic-detection.ts",
    ],
  );

  assert.deepEqual(result.changedFiles, [
    "packages/core/src/semantic-interpreter.ts",
    "packages/tui/src/render.ts",
  ]);
  assert.deepEqual(result.disallowedFiles, ["packages/tui/src/render.ts"]);
});

test("renderAutoresearchOptimizerRunMarkdown summarizes the optimization run clearly", () => {
  const run: AutoresearchOptimizerRun = {
    schemaVersion: 1,
    generatedAt: "2026-03-28T00:00:00.000Z",
    provider: "openclaw",
    optimizerCommand: "pnpm lab:autoresearch:optimizer --provider openclaw",
    summary: {
      beforeMismatchCount: 5,
      afterMismatchCount: 2,
      beforeInvariantMismatchCount: 0,
      afterInvariantMismatchCount: 0,
      improved: true,
    },
    artifacts: {
      briefPath: "packages/lab/results/autoresearch/briefs/example.json",
      beforeReportPath: "packages/lab/results/autoresearch/evaluations/before.json",
      afterReportPath: "packages/lab/results/autoresearch/evaluations/after.json",
      promptPath: "packages/lab/results/autoresearch/optimizer/prompts/example.md",
      rawOutputPath: "packages/lab/results/autoresearch/optimizer/raw/example.txt",
      patchPath: "packages/lab/results/autoresearch/optimizer/patches/example.diff",
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
    notes: ["Patched observational failure handling."],
  };

  const markdown = renderAutoresearchOptimizerRunMarkdown(run);

  assert.match(markdown, /Autoresearch Optimizer Run/);
  assert.match(markdown, /Status: improved/);
  assert.match(markdown, /packages\/core\/src\/semantic-interpreter\.ts/);
  assert.match(markdown, /Patched observational failure handling\./);
  assert.match(markdown, /patches\/example\.diff/);
});

test("defaultAutoresearchOptimizerPatchPath writes patch artifacts under the optimizer patches dir", () => {
  const filePath = defaultAutoresearchOptimizerPatchPath("2026-03-28T00:00:00.000Z");
  assert.match(filePath, /packages\/lab\/results\/autoresearch\/optimizer\/patches\/autoresearch-optimizer-patch-2026-03-28T00-00-00-000Z\.diff$/);
});

test("appendAutoresearchOptimizerResultsLog writes a header once and appends rows", async () => {
  const { mkdtemp, readFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");

  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-autoresearch-log-"));
  const filePath = path.join(directory, "results.tsv");
  const run: AutoresearchOptimizerRun = {
    schemaVersion: 1,
    generatedAt: "2026-03-28T00:00:00.000Z",
    provider: "openclaw",
    optimizerCommand: "pnpm lab:autoresearch:optimizer --provider openclaw",
    summary: {
      beforeMismatchCount: 5,
      afterMismatchCount: 4,
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
      changedFiles: ["packages/core/src/semantic-detection.ts"],
      disallowedFiles: [],
    },
    gates: {
      autoresearchEvaluate: true,
      judgmentBattle: true,
      releaseCheck: true,
    },
    status: "improved",
    notes: [],
  };

  await appendAutoresearchOptimizerResultsLog(filePath, run, {
    runPath: "optimizer-run.json",
  });
  await appendAutoresearchOptimizerResultsLog(filePath, run, {
    runPath: "optimizer-run.json",
  });

  const contents = await readFile(filePath, "utf8");
  const lines = contents.trim().split("\n");

  assert.equal(lines.length, 3);
  assert.match(lines[0] ?? "", /generated_at\tprovider\tstatus/);
  assert.match(lines[1] ?? "", /openclaw\timproved/);
});
