import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  applyOfflineReviewResponse,
  buildOfflineReviewRecommendationReport,
  compareOfflineReviewArtifact,
  createOfflineReviewRun,
  createSessionBundleFromSweSmithRow,
  defaultOfflineReviewPromptPath,
  offlineReviewValuesEqual,
  parseOpenClawReviewerOutput,
  parseOfflineReviewResponseText,
  prepareOfflineReviewArtifact,
  renderOfflineReviewPrompt,
  renderOfflineReviewRecommendationMarkdown,
  runOpenClawReview,
  validateOfflineReviewArtifact,
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
  patch: "diff --git a/file.py b/file.py\nindex 111..222 100644\n--- a/file.py\n+++ b/file.py\n@@\n-print('bad')\n+print('good')\n",
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
            arguments: "{\"command\":\"pytest tests/test_widget.py\"}",
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

test("prepareOfflineReviewArtifact distills bundle steps into review-ready snapshots", () => {
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const artifact = prepareOfflineReviewArtifact(bundle, {
    bundlePath: "/tmp/example-bundle.json",
  });

  assert.equal(artifact.bundle.bundlePath, "/tmp/example-bundle.json");
  assert.equal(artifact.steps[0]?.sourceEvent?.title, "MoneyWidget crashes on invalid provider responses");
  assert.match(artifact.steps[0]?.sourceExcerpt ?? "", /MoneyWidget crashes on invalid provider responses/);
  assert.equal(artifact.steps[1]?.apertureRead?.toolFamily, "bash");
  assert.equal(artifact.steps[2]?.apertureRead?.intentFrame, "failure");
  assert.equal(validateOfflineReviewArtifact(artifact)?.schemaVersion, 1);
});

test("compareOfflineReviewArtifact reports only real disagreements", () => {
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const artifact = prepareOfflineReviewArtifact(bundle);
  artifact.review.reviewer = "offline-reviewer";
  artifact.review.model = "test-model";
  artifact.review.findings.push(
    {
      stepIndex: 0,
      focusArea: "title",
      expected: "MoneyWidget crashes on invalid provider responses",
      confidence: "high",
      recommendation: "promote",
    },
    {
      stepIndex: 2,
      focusArea: "consequence",
      expected: "medium",
      confidence: "medium",
      supportingText: "This reads like a failure observation but not a destructive action.",
      recommendation: "inspect",
    },
  );

  const report = compareOfflineReviewArtifact(artifact, {
    generatedAt: "2026-03-27T00:00:00.000Z",
  });

  assert.equal(report.summary.totalFindings, 2);
  assert.equal(report.summary.matchedFindings, 1);
  assert.equal(report.summary.disagreementCount, 1);
  assert.equal(report.summary.disagreementsByFocusArea.consequence, 1);
  assert.equal(report.disagreements[0]?.stepIndex, 2);
  assert.equal(report.disagreements[0]?.focusArea, "consequence");
  assert.equal(report.disagreements[0]?.apertureValue, "high");
  assert.equal(report.disagreements[0]?.expectedValue, "medium");
});

test("offlineReviewValuesEqual normalizes annotated consequence labels", () => {
  assert.equal(offlineReviewValuesEqual("low", "low consequence; routine success output"), true);
  assert.equal(offlineReviewValuesEqual("medium", "medium consequence; expected diagnostic failure"), true);
  assert.equal(offlineReviewValuesEqual("high", "low consequence; routine success output"), false);
});

test("renderOfflineReviewPrompt packages the artifact for a reviewer model", () => {
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const artifact = prepareOfflineReviewArtifact(bundle, {
    bundlePath: "/tmp/example-bundle.json",
  });

  const prompt = renderOfflineReviewPrompt(artifact);
  const promptPath = defaultOfflineReviewPromptPath(artifact, "/tmp/offline-review-prompts");

  assert.match(prompt, /Aperture Offline Review Prompt/);
  assert.match(prompt, /Required Response Shape/);
  assert.match(prompt, /public:swe-smith:example-repo-123-run-42/);
  assert.match(promptPath, /\/tmp\/offline-review-prompts\/public-swe-smith-example-repo-123-run-42\.md$/);
});

test("parseOfflineReviewResponseText accepts fenced reviewer JSON and applies it", () => {
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const artifact = prepareOfflineReviewArtifact(bundle);

  const response = parseOfflineReviewResponseText(`
\`\`\`json
{
  "review": {
    "reviewer": "offline-reviewer",
    "model": "review-model",
    "completedAt": "2026-03-27T12:00:00.000Z",
    "findings": [
      {
        "stepIndex": 2,
        "focusArea": "consequence",
        "expected": "medium",
        "confidence": "high",
        "supportingText": "Failure text is clear, but not destructive.",
        "recommendation": "promote"
      }
    ]
  }
}
\`\`\`
  `);

  const completed = applyOfflineReviewResponse(artifact, response);

  assert.equal(completed.review.reviewer, "offline-reviewer");
  assert.equal(completed.review.model, "review-model");
  assert.equal(completed.review.findings.length, 1);
  assert.equal(completed.review.findings[0]?.focusArea, "consequence");
});

test("parseOpenClawReviewerOutput extracts the payload JSON from warning-prefixed stderr output", () => {
  const payload = parseOpenClawReviewerOutput(`
[tools] tools.profile warning
{
  "payloads": [
    {
      "text": "{\\"review\\":{\\"reviewer\\":\\"openclaw\\",\\"model\\":\\"gpt-5.4\\",\\"findings\\":[]}}",
      "mediaUrl": null
    }
  ]
}
  `);

  assert.equal(payload, "{\"review\":{\"reviewer\":\"openclaw\",\"model\":\"gpt-5.4\",\"findings\":[]}}");
});

test("parseOpenClawReviewerOutput prefers the final non-empty text payload", () => {
  const payload = parseOpenClawReviewerOutput(`
{
  "payloads": [
    {
      "text": "I'll inspect the repo layout first.",
      "mediaUrl": null
    },
    {
      "text": "{\\"review\\":{\\"reviewer\\":\\"openclaw\\",\\"model\\":\\"gpt-5.4\\",\\"findings\\":[]}}",
      "mediaUrl": null
    }
  ]
}
  `);

  assert.equal(payload, "{\"review\":{\"reviewer\":\"openclaw\",\"model\":\"gpt-5.4\",\"findings\":[]}}");
});

test("runOpenClawReview parses reviewer text from OpenClaw stderr envelopes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-openclaw-reviewer-"));

  try {
    const fakeOpenClawPath = path.join(tempDir, "openclaw");
    await writeFile(
      fakeOpenClawPath,
      [
        "#!/usr/bin/env node",
        "process.stderr.write('[tools] tools.profile warning\\\\n');",
        "process.stderr.write(JSON.stringify({ payloads: [{ text: JSON.stringify({ review: { reviewer: 'openclaw', model: 'fake', findings: [] } }) }] }));",
      ].join("\n"),
      "utf8",
    );
    await execFile("chmod", ["+x", fakeOpenClawPath]);

    const output = await runOpenClawReview("review this prompt", {
      bin: fakeOpenClawPath,
      cwd: REPO_ROOT,
      env: process.env,
      timeoutSeconds: 30,
    });

    assert.equal(output, "{\"review\":{\"reviewer\":\"openclaw\",\"model\":\"fake\",\"findings\":[]}}");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("recommendation reports cluster disagreements into bounded targets", () => {
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const artifact = prepareOfflineReviewArtifact(bundle);
  artifact.review.findings.push(
    {
      stepIndex: 0,
      focusArea: "title",
      expected: "MoneyWidget crashes on invalid provider responses",
      confidence: "high",
      recommendation: "promote",
    },
    {
      stepIndex: 2,
      focusArea: "consequence",
      expected: "medium",
      confidence: "medium",
      recommendation: "inspect",
    },
  );

  const report = compareOfflineReviewArtifact(artifact);
  const recommendation = buildOfflineReviewRecommendationReport(report, {
    generatedAt: "2026-03-27T00:00:00.000Z",
  });
  const markdown = renderOfflineReviewRecommendationMarkdown(recommendation);

  assert.equal(recommendation.status, "disagreement");
  assert.equal(recommendation.summary.disagreementCount, 1);
  assert.equal(recommendation.summary.actionableCount, 1);
  assert.equal(recommendation.items[0]?.focusArea, "consequence");
  assert.deepEqual(recommendation.items[0]?.targets, [
    "packages/core/src/semantic-detection.ts",
    "packages/core/src/semantic-interpreter.ts",
    "packages/core/src/semantic-language.ts",
  ]);
  assert.match(markdown, /Offline Review Recommendations/);
  assert.match(markdown, /consequence/);
});

test("offline review run summaries capture artifact paths and actionable counts", () => {
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const artifact = prepareOfflineReviewArtifact(bundle);
  const completed = applyOfflineReviewResponse(artifact, {
    review: {
      reviewer: "offline-reviewer",
      model: "review-model",
      findings: [
        {
          stepIndex: 2,
          focusArea: "consequence",
          expected: "medium",
          confidence: "medium",
          recommendation: "inspect",
        },
      ],
    },
  });
  const report = compareOfflineReviewArtifact(completed, {
    generatedAt: "2026-03-27T00:00:00.000Z",
  });
  const recommendation = buildOfflineReviewRecommendationReport(report, {
    generatedAt: "2026-03-27T00:00:00.000Z",
  });
  const run = createOfflineReviewRun(
    report,
    recommendation,
    {
      requestPath: "/tmp/request.json",
      promptPath: "/tmp/prompt.md",
      responsePath: "/tmp/response.json",
      reportPath: "/tmp/report.json",
      reportMarkdownPath: "/tmp/report.md",
      recommendationPath: "/tmp/recommendation.json",
      recommendationMarkdownPath: "/tmp/recommendation.md",
    },
    {
      generatedAt: "2026-03-27T00:00:00.000Z",
    },
  );

  assert.equal(run.status, "disagreement");
  assert.equal(run.summary.actionableCount, 1);
  assert.equal(run.artifacts.promptPath, "/tmp/prompt.md");
  assert.equal(run.artifacts.recommendationMarkdownPath, "/tmp/recommendation.md");
});

test("offline-review CLI can run a reviewer command and append the results log", async () => {
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const artifact = prepareOfflineReviewArtifact(bundle, {
    bundlePath: "/tmp/example-bundle.json",
  });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-offline-review-"));

  try {
    const artifactPath = path.join(tempDir, "request.json");
    const promptPath = path.join(tempDir, "prompt.md");
    const rawPath = path.join(tempDir, "reviewer.txt");
    const responseArtifactPath = path.join(tempDir, "response.json");
    const reportPath = path.join(tempDir, "report.json");
    const recommendationPath = path.join(tempDir, "recommendation.json");
    const runPath = path.join(tempDir, "run.json");
    const resultsLogPath = path.join(tempDir, "results.tsv");
    const reviewerScriptPath = path.join(tempDir, "reviewer.js");

    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    await writeFile(
      reviewerScriptPath,
      [
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { input += chunk; });",
        "process.stdin.on('end', () => {",
        "  process.stdout.write(JSON.stringify({",
        "    review: {",
        "      reviewer: 'cli-reviewer',",
        "      model: 'cli-model',",
        "      notes: input.includes('Aperture Offline Review Prompt') ? 'prompt-ok' : 'prompt-missing',",
        "      findings: [{",
        "        stepIndex: 2,",
        "        focusArea: 'consequence',",
        "        expected: 'medium',",
        "        confidence: 'medium',",
        "        recommendation: 'inspect'",
        "      }]",
        "    }",
        "  }));",
        "});",
      ].join("\n"),
      "utf8",
    );

    const { stdout } = await execFile(
      process.execPath,
      [
        TSX_CLI,
        "scripts/offline-review.ts",
        "run",
        "--artifact",
        artifactPath,
        "--reviewer-command",
        `${process.execPath} ${reviewerScriptPath}`,
        "--prompt",
        promptPath,
        "--raw-response-output",
        rawPath,
        "--response-artifact",
        responseArtifactPath,
        "--output",
        reportPath,
        "--recommendation-output",
        recommendationPath,
        "--run-output",
        runPath,
        "--results-log",
        resultsLogPath,
        "--json",
      ],
      {
        cwd: REPO_ROOT,
      },
    );

    const output = JSON.parse(stdout);
    const raw = await readFile(rawPath, "utf8");
    const resultsLog = await readFile(resultsLogPath, "utf8");

    assert.equal(output.status, "disagreement");
    assert.equal(output.rawResponsePath, rawPath);
    assert.match(raw, /cli-reviewer/);
    assert.match(resultsLog, /generated_at\tsession_id\tstatus/);
    assert.match(resultsLog, /public:swe-smith:example-repo-123-run-42/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("offline-reviewer adapter resolves provider commands from env and forwards stdout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-offline-reviewer-"));

  try {
    const reviewerScriptPath = path.join(tempDir, "provider-reviewer.js");
    await writeFile(
      reviewerScriptPath,
      [
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { input += chunk; });",
        "process.stdin.on('end', () => {",
        "  process.stdout.write(JSON.stringify({ review: { reviewer: 'provider-reviewer', notes: input.includes('semantic') ? 'prompt-ok' : 'prompt-missing', findings: [] } }));",
        "});",
      ].join("\n"),
      "utf8",
    );

    const shell = process.env.SHELL ?? "/bin/zsh";
    const quotedNode = JSON.stringify(process.execPath);
    const quotedTsx = JSON.stringify(TSX_CLI);
    const quotedReviewer = JSON.stringify(reviewerScriptPath);
    const { stdout } = await execFile(
      shell,
      [
        "-lc",
        `printf '%s' 'semantic review prompt' | ${quotedNode} ${quotedTsx} scripts/offline-reviewer.ts --provider hermes`,
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          APERTURE_HERMES_REVIEWER_COMMAND: `${process.execPath} ${quotedReviewer}`,
        },
      },
    );

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.review.reviewer, "provider-reviewer");
    assert.equal(parsed.review.notes, "prompt-ok");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
