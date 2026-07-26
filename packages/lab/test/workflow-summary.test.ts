import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  createSessionBundleFromSweSmithRow,
  createWorkflowSummaryReport,
  renderWorkflowSummaryMarkdown,
  writeSessionBundle,
  type ReplaySessionBundle,
  type SweSmithRow,
} from "../src/index.js";

const execFile = promisify(execFileCallback);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");
const TSX_CLI = path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");

const SAMPLE_ROW: SweSmithRow = {
  instance_id: "example/repo-123",
  model: "claude-3-7-sonnet-20250219",
  resolved: true,
  traj_id: "example/repo-123.run-42",
  patch:
    "diff --git a/file.py b/file.py\nindex 111..222 100644\n--- a/file.py\n+++ b/file.py\n@@\n-print('bad')\n+print('good')\n",
  messages: JSON.stringify([
    {
      role: "system",
      content: "You are a helpful assistant that can interact with a computer to solve tasks.",
      agent: "main",
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
      agent: "main",
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "I'll reproduce the failure first.",
      thought: "Reproduce before patching.",
      action: "pytest tests/test_widget.py",
      agent: "main",
      tool_calls: [
        {
          index: 0,
          function: {
            name: "bash",
            arguments: '{"command":"pytest tests/test_widget.py"}',
          },
          id: "toolu_bash",
          type: "function",
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
      agent: "main",
      tool_call_ids: ["toolu_bash"],
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "",
      thought: "Done.",
      action: "submit",
      agent: "main",
      tool_calls: [
        {
          index: 0,
          function: {
            name: "submit",
            arguments: "{}",
          },
          id: "toolu_submit",
          type: "function",
        },
      ],
      message_type: "action",
    },
  ]),
};

test("workflow summaries aggregate approvals, runners, and usage across bundles", () => {
  const left = buildWorkflowBundle("session:alpha", {
    model: "gpt-5.4",
    runner: "codex",
    inputTokens: 900,
    outputTokens: 140,
    costUsd: 0.09,
  });
  const right = buildWorkflowBundle("session:beta", {
    model: "claude-sonnet-4",
    runner: "claude-code",
    inputTokens: 1100,
    outputTokens: 210,
    costUsd: 0.11,
  });

  const report = createWorkflowSummaryReport([left, right], {
    generatedAt: "2026-04-26T00:00:00.000Z",
  });
  const markdown = renderWorkflowSummaryMarkdown(report);

  assert.equal(report.summary.sessionCount, 2);
  assert.equal(report.summary.requestKinds.approval, 2);
  assert.equal(report.summary.statuses.waiting, 2);
  assert.deepEqual(report.summary.workflow?.runners, ["claude-code", "codex"]);
  assert.deepEqual(report.summary.workflow?.models, ["claude-sonnet-4", "gpt-5.4"]);
  assert.equal(report.summary.workflow?.usageTotals.inputTokens, 2000);
  assert.equal(report.summary.workflow?.usageTotals.outputTokens, 350);
  assert.equal(report.summary.workflow?.usageTotals.costUsd, 0.2);
  assert.match(
    markdown,
    /- workflow: surfaces=terminal; runners=claude-code, codex; placements=cloud; approval states=pending; models=claude-sonnet-4, gpt-5.4/,
  );
  assert.match(markdown, /- workflow usage: input=2,000, output=350, cost=\$0.20/);
  assert.match(markdown, /### session:alpha/);
  assert.match(markdown, /- request kinds: approval=1/);
});

test("workflow-summary CLI emits machine-readable summaries from bundle inputs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-workflow-summary-"));
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(
    bundlePath,
    buildWorkflowBundle("session:cli", {
      model: "gpt-5.4",
      runner: "codex",
      inputTokens: 500,
      outputTokens: 125,
      costUsd: 0.04,
    }),
  );

  const { stdout } = await execFile(
    process.execPath,
    [TSX_CLI, "scripts/fstop.ts", "workflow-summary", "--bundle", bundlePath, "--json"],
    {
      cwd: REPO_ROOT,
    },
  );

  const payload = JSON.parse(stdout) as {
    status: string;
    report: ReturnType<typeof createWorkflowSummaryReport>;
  };

  assert.equal(payload.status, "ok");
  assert.equal(payload.report.summary.sessionCount, 1);
  assert.equal(payload.report.summary.requestKinds.approval, 1);
  assert.deepEqual(payload.report.summary.workflow?.runners, ["codex"]);
  assert.equal(payload.report.summary.workflow?.usageTotals.outputTokens, 125);
});

test("workflow-summary CLI summarizes bundle directories without retaining duplicate inputs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-workflow-summary-dir-"));
  const nestedDir = path.join(tempDir, "nested");
  const bundlePath = path.join(nestedDir, "bundle.json");
  const outputPath = path.join(tempDir, "summary.md");

  await writeSessionBundle(
    bundlePath,
    buildWorkflowBundle("session:dir", {
      model: "gpt-5.4",
      runner: "codex",
      inputTokens: 300,
      outputTokens: 75,
      costUsd: 0.02,
    }),
  );
  await writeFile(
    path.join(tempDir, "not-a-bundle.json"),
    '{"schemaVersion":"not-session"}\n',
    "utf8",
  );

  const { stdout } = await execFile(
    process.execPath,
    [
      TSX_CLI,
      "scripts/fstop.ts",
      "workflow-summary",
      "--bundle",
      bundlePath,
      "--bundle-dir",
      tempDir,
      "--output",
      outputPath,
      "--json",
    ],
    {
      cwd: REPO_ROOT,
    },
  );

  const payload = JSON.parse(stdout) as {
    status: string;
    outputPath: string;
    report: ReturnType<typeof createWorkflowSummaryReport>;
  };
  const markdown = await readFile(outputPath, "utf8");

  assert.equal(payload.status, "ok");
  assert.equal(payload.outputPath, outputPath);
  assert.equal(payload.report.summary.sessionCount, 1);
  assert.equal(payload.report.summary.eventCount, 6);
  assert.match(markdown, /### session:dir/);
});

function buildWorkflowBundle(
  sessionId: string,
  options: {
    model: string;
    runner: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  },
): ReplaySessionBundle {
  const base = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const normalizedEvents = base.normalizedEvents.map((snapshot, index) => ({
    ...snapshot,
    event:
      index === 0
        ? {
            ...snapshot.event,
            metadata: {
              execution: {
                surface: "terminal",
                placement: "cloud",
                runner: options.runner,
              },
              usage: {
                model: options.model,
                inputTokens: options.inputTokens,
                outputTokens: options.outputTokens,
                costUsd: options.costUsd,
              },
            },
          }
        : snapshot.event,
  }));

  normalizedEvents.push({
    stepIndex: normalizedEvents.length,
    stepKind: "publishSource",
    stepLabel: "approval requested",
    event: {
      id: `${sessionId}:approval`,
      taskId: `${sessionId}:deploy`,
      timestamp: "2026-04-26T00:00:05.000Z",
      type: "human.input.requested",
      interactionId: `${sessionId}:approval`,
      title: "Approve deploy",
      summary: "A production deployment needs approval.",
      request: {
        kind: "approval",
      },
      metadata: {
        execution: {
          surface: "terminal",
          placement: "cloud",
          runner: options.runner,
        },
        governance: {
          approvalState: "pending",
        },
        usage: {
          model: options.model,
        },
      },
    },
  });

  normalizedEvents.push({
    stepIndex: normalizedEvents.length,
    stepKind: "publishSource",
    stepLabel: "waiting on approval",
    event: {
      id: `${sessionId}:waiting`,
      taskId: `${sessionId}:deploy`,
      timestamp: "2026-04-26T00:00:06.000Z",
      type: "task.updated",
      title: "Deploy is waiting",
      summary: "Waiting for operator approval.",
      status: "waiting",
      metadata: {
        execution: {
          surface: "terminal",
          placement: "cloud",
          runner: options.runner,
        },
        governance: {
          approvalState: "pending",
        },
      },
    },
  });

  return {
    ...base,
    sessionId,
    title: `Workflow ${sessionId}`,
    normalizedEvents,
  };
}
