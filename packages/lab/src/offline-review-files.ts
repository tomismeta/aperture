import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_OFFLINE_REVIEW_DISAGREEMENTS_DIR,
  DEFAULT_OFFLINE_REVIEW_PROMPT_DIR,
  DEFAULT_OFFLINE_REVIEW_RAW_DIR,
  DEFAULT_OFFLINE_REVIEW_RECOMMENDATIONS_DIR,
  DEFAULT_OFFLINE_REVIEW_REQUESTS_DIR,
  DEFAULT_OFFLINE_REVIEW_RESPONSES_DIR,
  DEFAULT_OFFLINE_REVIEW_RUNS_DIR,
  type OfflineReviewArtifact,
  type OfflineReviewRecommendationReport,
  type OfflineReviewReport,
  type OfflineReviewRun,
  validateOfflineReviewArtifact,
} from "./offline-review.js";

export async function writeOfflineReviewArtifact(
  filePath: string,
  artifact: OfflineReviewArtifact,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

export async function writeOfflineReviewReport(
  filePath: string,
  report: OfflineReviewReport,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function writeOfflineReviewRecommendationReport(
  filePath: string,
  report: OfflineReviewRecommendationReport,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function writeOfflineReviewRun(
  filePath: string,
  run: OfflineReviewRun,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export async function loadOfflineReviewArtifact(filePath: string): Promise<OfflineReviewArtifact> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse offline review artifact at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const artifact = validateOfflineReviewArtifact(parsed);
  if (!artifact) {
    throw new Error(`Invalid offline review artifact at ${filePath}`);
  }

  return artifact;
}

export function defaultOfflineReviewArtifactPath(
  artifact: OfflineReviewArtifact,
  directory: string = DEFAULT_OFFLINE_REVIEW_REQUESTS_DIR,
): string {
  return path.join(directory, `${safeFilename(artifact.bundle.sessionId)}.json`);
}

export function defaultOfflineReviewResponsePath(
  artifact: OfflineReviewArtifact,
  directory: string = DEFAULT_OFFLINE_REVIEW_RESPONSES_DIR,
): string {
  return path.join(directory, `${safeFilename(artifact.bundle.sessionId)}.json`);
}

export function defaultOfflineReviewReportPath(
  artifact: OfflineReviewArtifact,
  directory: string = DEFAULT_OFFLINE_REVIEW_DISAGREEMENTS_DIR,
): string {
  return path.join(directory, `${safeFilename(artifact.bundle.sessionId)}.json`);
}

export function defaultOfflineReviewPromptPath(
  artifact: OfflineReviewArtifact,
  directory: string = DEFAULT_OFFLINE_REVIEW_PROMPT_DIR,
): string {
  return path.join(directory, `${safeFilename(artifact.bundle.sessionId)}.md`);
}

export function defaultOfflineReviewRawResponsePath(
  artifact: OfflineReviewArtifact,
  directory: string = DEFAULT_OFFLINE_REVIEW_RAW_DIR,
): string {
  return path.join(directory, `${safeFilename(artifact.bundle.sessionId)}.txt`);
}

export function defaultOfflineReviewRecommendationPath(
  artifact: OfflineReviewArtifact,
  directory: string = DEFAULT_OFFLINE_REVIEW_RECOMMENDATIONS_DIR,
): string {
  return path.join(directory, `${safeFilename(artifact.bundle.sessionId)}.json`);
}

export function defaultOfflineReviewRunPath(
  artifact: OfflineReviewArtifact,
  directory: string = DEFAULT_OFFLINE_REVIEW_RUNS_DIR,
): string {
  return path.join(directory, `${safeFilename(artifact.bundle.sessionId)}.json`);
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}
