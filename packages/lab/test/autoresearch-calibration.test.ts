import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAutoresearchOptimizationBrief,
  createSessionBundleFromSweSmithRow,
  defaultAutoresearchCalibrationCasePath,
  evaluateAutoresearchCalibrationCases,
  prepareOfflineReviewArtifact,
  promoteOfflineReviewReportToCalibrationCase,
  readOfflineReviewFocusAreaValue,
  renderAutoresearchCalibrationMarkdown,
  renderAutoresearchOptimizationMarkdown,
  writeAutoresearchCalibrationCase,
  writeSessionBundle,
  type OfflineReviewReport,
  type SweSmithRow,
} from "../src/index.js";

const SAMPLE_ROW: SweSmithRow = {
  instance_id: "example/repo-123",
  model: "claude-3-7-sonnet-20250219",
  resolved: true,
  traj_id: "example/repo-123.run-42",
  patch: "diff --git a/file.py b/file.py\nindex 111..222 100644\n--- a/file.py\n+++ b/file.py\n@@\n-print('bad')\n+print('good')\n",
  messages: JSON.stringify([
    {
      role: "system",
      content: "You are a helpful assistant that can interact with a computer to solve tasks.",
      message_type: "system_prompt",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "We're currently solving the following issue within our repository. ISSUE:\nMoneyWidget crashes on invalid provider responses\nTraceback shows string indices must be integers.",
        },
      ],
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "I'll reproduce the failure first.",
      action: "pytest tests/test_widget.py",
      tool_calls: [
        {
          function: {
            name: "bash",
            arguments: "{\"command\":\"pytest tests/test_widget.py\"}",
          },
        },
      ],
      message_type: "action",
    },
    {
      role: "tool",
      content: [
        {
          type: "text",
          text: "Traceback (most recent call last): TypeError: string indices must be integers",
        },
      ],
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "I'll patch the provider handling now.",
      action: "apply_patch <<'PATCH' ...",
      tool_calls: [
        {
          function: {
            name: "edit",
            arguments: "{\"path\":\"/testbed/provider.py\"}",
          },
        },
      ],
      message_type: "action",
    },
    {
      role: "tool",
      content: [
        {
          type: "text",
          text: "Patch applied successfully.",
        },
      ],
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "",
      action: "submit",
      tool_calls: [
        {
          function: {
            name: "submit",
            arguments: "{}",
          },
        },
      ],
      message_type: "action",
    },
  ]),
};

test("promoted calibration cases freeze corrected expectations and evaluate reruns deterministically", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aperture-autoresearch-"));
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const bundlePath = path.join(repoRoot, "bundles", "sample.json");
  await writeSessionBundle(bundlePath, bundle);

  const artifact = prepareOfflineReviewArtifact(bundle, {
    bundlePath: path.relative(repoRoot, bundlePath),
  });
  const failedStep = artifact.steps.find((step) => step.sourceEvent?.status === "failed");
  assert.ok(failedStep);
  assert.equal(readOfflineReviewFocusAreaValue(failedStep, "intentFrame"), "failure");
  assert.equal(readOfflineReviewFocusAreaValue(failedStep, "toolFamily"), "bash");

  const report: OfflineReviewReport = {
    schemaVersion: 1,
    generatedAt: "2026-03-28T00:00:00.000Z",
    rubricVersion: "offline-ai-review-v1",
    bundle: {
      sessionId: bundle.sessionId,
      title: bundle.title,
      bundlePath,
    },
    review: {
      reviewer: "openclaw",
      model: "gpt-5.4",
    },
    summary: {
      totalFindings: 2,
      disagreementCount: 2,
      matchedFindings: 0,
      disagreementsByFocusArea: {
        title: 0,
        summary: 0,
        status: 0,
        intentFrame: 1,
        toolFamily: 0,
        consequence: 1,
      },
    },
    disagreements: [
      {
        stepIndex: failedStep.stepIndex,
        ...(failedStep.stepLabel ? { stepLabel: failedStep.stepLabel } : {}),
        focusArea: "intentFrame",
        apertureValue: "failure",
        expectedValue: "status_update",
        confidence: "high",
        recommendation: "promote",
      },
      {
        stepIndex: failedStep.stepIndex,
        ...(failedStep.stepLabel ? { stepLabel: failedStep.stepLabel } : {}),
        focusArea: "consequence",
        apertureValue: "high",
        expectedValue: "medium",
        confidence: "high",
        recommendation: "promote",
      },
    ],
  };

  const reportPath = path.join(repoRoot, "reports", "sample-report.json");
  await writeJson(reportPath, report);

  const calibrationCase = await promoteOfflineReviewReportToCalibrationCase(reportPath, {
    split: "train",
    repoRoot,
    includeStepInvariants: true,
  });

  assert.equal(calibrationCase.summary.correctedCount, 2);
  assert.ok(calibrationCase.summary.invariantCount >= 1);
  assert.ok(calibrationCase.targets.includes("packages/core/src/semantic-interpreter.ts"));
  assert.equal(calibrationCase.bundlePath, "bundles/sample.json");

  const casePath = defaultAutoresearchCalibrationCasePath(
    calibrationCase,
    path.join(repoRoot, "packages", "lab", "calibration", "train"),
  );
  await writeAutoresearchCalibrationCase(casePath, calibrationCase);

  const evaluation = await evaluateAutoresearchCalibrationCases([
    {
      filePath: path.relative(repoRoot, casePath),
      calibrationCase,
    },
  ], {
    repoRoot,
    generatedAt: "2026-03-28T00:00:00.000Z",
  });

  assert.equal(evaluation.summary.caseCount, 1);
  assert.equal(evaluation.summary.expectationCount, calibrationCase.expectations.length);
  assert.equal(evaluation.summary.correctedMismatchCount, 2);
  assert.equal(evaluation.summary.invariantMismatchCount, 0);
  assert.equal(evaluation.results[0]?.mismatches.length, 2);

  const brief = createAutoresearchOptimizationBrief(evaluation, {
    generatedAt: "2026-03-28T00:00:00.000Z",
    reportPath: "/tmp/evaluation.json",
  });
  assert.equal(brief.priorities[0]?.focusArea, "consequence");
  assert.ok(brief.priorities.some((entry) => entry.focusArea === "intentFrame"));

  assert.match(renderAutoresearchCalibrationMarkdown(evaluation), /Autoresearch Calibration Report/);
  assert.match(renderAutoresearchOptimizationMarkdown(brief), /Autoresearch Optimization Brief/);
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(path.dirname(filePath), { recursive: true })
    .then(() => writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")));
}
