import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FStopProvider } from "./fstop-role.js";
import { runFStopRolePrompt } from "./fstop-role.js";
import {
  applyOfflineReviewResponse,
  buildOfflineReviewRecommendationReport,
  compareOfflineReviewArtifact,
  createOfflineReviewRun,
  defaultOfflineReviewPromptPath,
  defaultOfflineReviewRawResponsePath,
  defaultOfflineReviewRecommendationPath,
  defaultOfflineReviewReportPath,
  defaultOfflineReviewResponsePath,
  defaultOfflineReviewRunPath,
  loadOfflineReviewArtifact,
  parseOfflineReviewResponseText,
  renderOfflineReviewPrompt,
  renderOfflineReviewRecommendationMarkdown,
  renderOfflineReviewReportMarkdown,
  writeOfflineReviewArtifact,
  writeOfflineReviewRecommendationReport,
  writeOfflineReviewReport,
  writeOfflineReviewRun,
  type OfflineReviewResponsePayload,
  type OfflineReviewRunStatus,
} from "./offline-review.js";

export type OfflineReviewArtifactRunOptions = {
  artifactPath: string;
  reviewerCommand?: string;
  reviewerProvider?: FStopProvider;
  responseArtifactPath?: string;
  responseText?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  outputPath?: string;
  promptPath?: string;
  rawResponsePath?: string;
  recommendationPath?: string;
  runPath?: string;
};

export type OfflineReviewArtifactRunResult = {
  status: OfflineReviewRunStatus;
  bundleSessionId: string;
  requestPath: string;
  promptPath: string;
  rawResponsePath: string;
  responseArtifactPath: string;
  reportPath: string;
  reportMarkdownPath: string;
  recommendationPath: string;
  recommendationMarkdownPath: string;
  runPath: string;
  totalFindings: number;
  matchedFindings: number;
  disagreementCount: number;
  actionableCount: number;
};

export async function runOfflineReviewArtifactReview(
  options: OfflineReviewArtifactRunOptions,
): Promise<OfflineReviewArtifactRunResult> {
  const workingDir = options.cwd ?? process.cwd();
  const artifact = await loadOfflineReviewArtifact(options.artifactPath);
  const promptPath = options.promptPath ?? defaultOfflineReviewPromptPath(artifact);
  const prompt = renderOfflineReviewPrompt(artifact);
  await writeText(promptPath, prompt);

  const rawResponsePath = options.rawResponsePath ?? defaultOfflineReviewRawResponsePath(artifact);
  const rawResponse = options.responseText ?? await runFStopRolePrompt("reviewer", prompt, {
    provider: options.reviewerProvider ?? "generic",
    ...(options.reviewerCommand ? { command: options.reviewerCommand } : {}),
    cwd: workingDir,
    ...(options.env ? { env: options.env } : {}),
  });
  await writeText(rawResponsePath, rawResponse);

  const response = await parseOrRepairReviewerResponse(rawResponse, options);
  const completedArtifact = applyOfflineReviewResponse(artifact, response);
  const responseArtifactPath = options.responseArtifactPath ?? defaultOfflineReviewResponsePath(completedArtifact);
  await writeOfflineReviewArtifact(responseArtifactPath, completedArtifact);

  const report = compareOfflineReviewArtifact(completedArtifact);
  const reportPath = options.outputPath ?? defaultOfflineReviewReportPath(completedArtifact);
  const reportMarkdownPath = reportPath.replace(/\.json$/i, ".md");
  await writeOfflineReviewReport(reportPath, report);
  await writeText(reportMarkdownPath, renderOfflineReviewReportMarkdown(report));

  const recommendation = buildOfflineReviewRecommendationReport(report);
  const recommendationPath = options.recommendationPath ?? defaultOfflineReviewRecommendationPath(completedArtifact);
  const recommendationMarkdownPath = recommendationPath.replace(/\.json$/i, ".md");
  await writeOfflineReviewRecommendationReport(recommendationPath, recommendation);
  await writeText(
    recommendationMarkdownPath,
    renderOfflineReviewRecommendationMarkdown(recommendation),
  );

  const runPath = options.runPath ?? defaultOfflineReviewRunPath(completedArtifact);
  const run = createOfflineReviewRun(report, recommendation, {
    requestPath: options.artifactPath,
    promptPath,
    rawResponsePath,
    responsePath: responseArtifactPath,
    reportPath,
    reportMarkdownPath,
    recommendationPath,
    recommendationMarkdownPath,
    runPath,
  });
  await writeOfflineReviewRun(runPath, run);

  return {
    status: run.status,
    bundleSessionId: completedArtifact.bundle.sessionId,
    requestPath: options.artifactPath,
    promptPath,
    rawResponsePath,
    responseArtifactPath,
    reportPath,
    reportMarkdownPath,
    recommendationPath,
    recommendationMarkdownPath,
    runPath,
    totalFindings: report.summary.totalFindings,
    matchedFindings: report.summary.matchedFindings,
    disagreementCount: report.summary.disagreementCount,
    actionableCount: recommendation.summary.actionableCount,
  };
}

async function parseOrRepairReviewerResponse(
  rawResponse: string,
  options: OfflineReviewArtifactRunOptions,
): Promise<OfflineReviewResponsePayload> {
  const workingDir = options.cwd ?? process.cwd();
  try {
    return parseOfflineReviewResponseText(rawResponse);
  } catch (error) {
    const canRepair = options.reviewerCommand || options.reviewerProvider;
    if (!canRepair || options.responseText !== undefined) {
      throw error;
    }

    const repaired = await runFStopRolePrompt(
      "reviewer",
      buildReviewerRepairPrompt(rawResponse),
      {
        provider: options.reviewerProvider ?? "generic",
        ...(options.reviewerCommand ? { command: options.reviewerCommand } : {}),
        cwd: workingDir,
        ...(options.env ? { env: options.env } : {}),
      },
    );
    return parseOfflineReviewResponseText(repaired);
  }
}

function buildReviewerRepairPrompt(rawResponse: string): string {
  return [
    "# Aperture Offline Review JSON Repair",
    "",
    "Convert the previous reviewer answer into strict JSON.",
    "Return JSON only with exactly one top-level `review` object.",
    "Do not add markdown fences, explanations, shell commands, or prose.",
    "Preserve the original findings and intent as closely as possible.",
    "If the previous answer contains no valid findings, return `{\"review\":{\"findings\":[]}}`.",
    "",
    "Response shape:",
    "",
    "```json",
    JSON.stringify(
      {
        review: {
          reviewer: "reviewer-name",
          model: "model-id",
          completedAt: "2026-03-27T00:00:00.000Z",
          notes: "optional short note",
          findings: [
            {
              stepIndex: 0,
              focusArea: "title",
              expected: "expected value",
              confidence: "high",
              supportingText: "source evidence",
              rationale: "brief explanation",
              recommendation: "promote",
            },
          ],
        },
      },
      null,
      2,
    ),
    "```",
    "",
    "Previous answer:",
    "",
    "```text",
    rawResponse.trim(),
    "```",
    "",
  ].join("\n");
}

async function writeText(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

export async function readOfflineReviewResponseText(filePath: string): Promise<string> {
  return await readFile(filePath, "utf8");
}
