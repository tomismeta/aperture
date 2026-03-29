import assert from "node:assert/strict";
import test from "node:test";

import {
  assessAutoresearchEditSurface,
  buildAutoresearchEvaluationCommands,
  defaultAutoresearchOptimizerPatchPath,
  parseAutoresearchOptimizerFeedback,
  renderAutoresearchOptimizationPrompt,
  renderAutoresearchOptimizerRunMarkdown,
  type AutoresearchOptimizationBrief,
  type AutoresearchOptimizerFeedback,
  type AutoresearchOptimizerRun,
} from "../src/index.js";

test("renderAutoresearchOptimizationPrompt points the optimizer at the bounded surface", () => {
  const brief: AutoresearchOptimizationBrief = {
    schemaVersion: 1,
    generatedAt: "2026-03-28T00:00:00.000Z",
    reportPath: ".aperture/lab/results/autoresearch/evaluations/example.json",
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
      "pnpm lab:fstop:evaluate",
      "pnpm judgment:battle",
    ],
    guidance: [
      "Reduce corrected mismatches first.",
    ],
  };

  const prompt = renderAutoresearchOptimizationPrompt(brief);

  assert.match(prompt, /Aperture Lab F-Stop Optimization Task/);
  assert.match(prompt, /skills\/aperture-lab-optimizer\/SKILL.md/);
  assert.match(prompt, /packages\/core\/src\/semantic-interpreter\.ts/);
  assert.match(prompt, /pnpm judgment:battle/);
  assert.match(prompt, /failure -> status_update/);
  assert.match(prompt, /Return only one JSON object/);
  assert.match(prompt, /"action": "patched" \| "no_patch"/);
  assert.match(prompt, /Do not create commits or switch branches/);
});

test("buildAutoresearchEvaluationCommands preserves extra calibration dirs for optimizer reruns", () => {
  const commands = buildAutoresearchEvaluationCommands([
    "/tmp/autoresearch candidate/train",
    "/tmp/quote's-test",
  ]);

  assert.deepEqual(commands, [
    "pnpm lab:fstop:evaluate --extra-calibration-dir '/tmp/autoresearch candidate/train' --extra-calibration-dir '/tmp/quote'\"'\"'s-test'",
    "pnpm judgment:battle",
    "pnpm release:check",
  ]);
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

test("parseAutoresearchOptimizerFeedback accepts fenced JSON optimizer output", () => {
  const feedback = parseAutoresearchOptimizerFeedback(`
I checked the prompt and ran the gates.

\`\`\`json
{
  "action": "no_patch",
  "summary": "No safe semantic change reduced mismatches.",
  "reasons": ["The targeted rule also flipped heldout invariants."],
  "recommendedFiles": ["packages/core/src/semantic-interpreter.ts"],
  "changedFiles": [],
  "commandsRun": ["pnpm lab:fstop:evaluate", "pnpm judgment:battle"],
  "beforeMismatchCount": 5,
  "afterMismatchCount": 5,
  "judgmentBattle": "not_run",
  "releaseCheck": "not_run"
}
\`\`\`
`);

  assert.deepEqual(feedback, {
    action: "no_patch",
    summary: "No safe semantic change reduced mismatches.",
    reasons: ["The targeted rule also flipped heldout invariants."],
    recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
    changedFiles: [],
    commandsRun: ["pnpm lab:fstop:evaluate", "pnpm judgment:battle"],
    beforeMismatchCount: 5,
    afterMismatchCount: 5,
    judgmentBattle: "not_run",
    releaseCheck: "not_run",
  } satisfies AutoresearchOptimizerFeedback);
});

test("parseAutoresearchOptimizerFeedback rejects non-JSON summaries", () => {
  assert.equal(
    parseAutoresearchOptimizerFeedback("I found the active repo and loaded the optimizer instructions."),
    null,
  );
});

test("renderAutoresearchOptimizerRunMarkdown summarizes the optimization run clearly", () => {
  const run: AutoresearchOptimizerRun = {
    schemaVersion: 1,
    generatedAt: "2026-03-28T00:00:00.000Z",
    provider: "openclaw",
    optimizerCommand: "pnpm lab:fstop:optimizer --provider openclaw",
    summary: {
      beforeMismatchCount: 5,
      afterMismatchCount: 2,
      beforeInvariantMismatchCount: 0,
      afterInvariantMismatchCount: 0,
      improved: true,
    },
    artifacts: {
      briefPath: ".aperture/lab/results/autoresearch/briefs/example.json",
      beforeReportPath: ".aperture/lab/results/autoresearch/evaluations/before.json",
      afterReportPath: ".aperture/lab/results/autoresearch/evaluations/after.json",
      promptPath: ".aperture/lab/results/autoresearch/optimizer/prompts/example.md",
      rawOutputPath: ".aperture/lab/results/autoresearch/optimizer/raw/example.txt",
      patchPath: ".aperture/lab/results/autoresearch/optimizer/patches/example.diff",
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
      summary: "Downgraded review-like observations from failure to status_update.",
      reasons: ["Repeated imported review messages were overclassified as failure."],
      recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
      changedFiles: ["packages/core/src/semantic-interpreter.ts"],
      commandsRun: [
        "pnpm lab:fstop:evaluate --extra-calibration-dir /tmp/candidate",
        "pnpm judgment:battle",
        "pnpm release:check",
      ],
      beforeMismatchCount: 5,
      afterMismatchCount: 2,
      judgmentBattle: "pass",
      releaseCheck: "pass",
    },
    notes: ["Patched observational failure handling."],
  };

  const markdown = renderAutoresearchOptimizerRunMarkdown(run);

  assert.match(markdown, /Aperture Lab F-Stop Optimizer Run/);
  assert.match(markdown, /Status: improved/);
  assert.match(markdown, /packages\/core\/src\/semantic-interpreter\.ts/);
  assert.match(markdown, /Patched observational failure handling\./);
  assert.match(markdown, /patches\/example\.diff/);
  assert.match(markdown, /Optimizer Feedback/);
  assert.match(markdown, /action: patched/);
  assert.match(markdown, /Downgraded review-like observations/);
});

test("defaultAutoresearchOptimizerPatchPath writes patch artifacts under the optimizer patches dir", () => {
  const filePath = defaultAutoresearchOptimizerPatchPath("2026-03-28T00:00:00.000Z");
  assert.match(filePath, /\.aperture\/lab\/results\/autoresearch\/optimizer\/patches\/autoresearch-optimizer-patch-2026-03-28T00-00-00-000Z\.diff$/);
});
