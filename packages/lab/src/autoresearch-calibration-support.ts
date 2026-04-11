import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  ALL_OFFLINE_REVIEW_FOCUS_AREAS,
  type OfflineReviewConfidence,
  type OfflineReviewFocusArea,
  type OfflineReviewRecommendation,
} from "./offline-review.js";
import {
  SEMANTIC_CALIBRATION_FAMILIES,
  type ReplaySemanticCalibrationFamily,
} from "./semantic-calibration.js";
import { isRecord } from "./shape.js";
import type { AutoresearchCalibrationSplit } from "./autoresearch-calibration.js";

export function invariantFocusAreasForStep(
  selectedFocusAreas: Set<OfflineReviewFocusArea>,
): OfflineReviewFocusArea[] {
  const invariantCandidates: OfflineReviewFocusArea[] = [
    "status",
    "toolFamily",
    "consequence",
    "blocking",
    "episode",
    "confidence",
  ];
  return invariantCandidates.filter((focusArea) => !selectedFocusAreas.has(focusArea));
}

export function resolveRepoRelativeCalibrationInputPath(
  inputPath: string | undefined,
  repoRoot: string,
): string {
  if (!inputPath) {
    throw new Error("Offline review report is missing bundle.bundlePath.");
  }
  return resolveRepoRelativePath(inputPath, repoRoot);
}

export function resolveRepoRelativePath(filePath: string, repoRoot: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  const relative = path.relative(repoRoot, absolute);
  if (relative.startsWith("..")) {
    throw new Error(`Path ${filePath} is outside repo root ${repoRoot}.`);
  }
  return relative;
}

export function createOfflineReviewFocusAreaCounts(): Record<OfflineReviewFocusArea, number> {
  return Object.fromEntries(
    ALL_OFFLINE_REVIEW_FOCUS_AREAS.map((focusArea) => [focusArea, 0]),
  ) as Record<OfflineReviewFocusArea, number>;
}

export function createSemanticFamilyCounts(): Record<ReplaySemanticCalibrationFamily, number> {
  return Object.fromEntries(
    SEMANTIC_CALIBRATION_FAMILIES.map((family) => [family, 0]),
  ) as Record<ReplaySemanticCalibrationFamily, number>;
}

export function createFocusAreaCountsFromRecord(
  value: Record<string, unknown>,
): Record<OfflineReviewFocusArea, number> {
  const counts = createOfflineReviewFocusAreaCounts();
  for (const focusArea of ALL_OFFLINE_REVIEW_FOCUS_AREAS) {
    counts[focusArea] = typeof value[focusArea] === "number" ? value[focusArea] : 0;
  }
  return counts;
}

export function isCalibrationSplit(value: unknown): value is AutoresearchCalibrationSplit {
  return value === "train" || value === "validation" || value === "heldout";
}

export function isOfflineReviewFocusArea(value: unknown): value is OfflineReviewFocusArea {
  return typeof value === "string" && ALL_OFFLINE_REVIEW_FOCUS_AREAS.includes(value as OfflineReviewFocusArea);
}

export function isSemanticCalibrationFamily(
  value: unknown,
): value is ReplaySemanticCalibrationFamily {
  return typeof value === "string"
    && (SEMANTIC_CALIBRATION_FAMILIES as readonly string[]).includes(value);
}

export function isOfflineReviewConfidence(value: unknown): value is OfflineReviewConfidence {
  return value === "high" || value === "medium" || value === "low";
}

export function isOfflineReviewRecommendation(value: unknown): value is OfflineReviewRecommendation {
  return value === "promote" || value === "inspect" || value === "ignore";
}

export function isOfflineReviewValue(value: unknown): value is string | string[] | boolean | null {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

export function confidenceRank(value: OfflineReviewConfidence): number {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

export function collectSemanticFamilies(
  entries: Array<{
    focusArea: OfflineReviewFocusArea;
    apertureValue: string | string[] | boolean | null;
    expectedValue: string | string[] | boolean | null;
  }>,
): ReplaySemanticCalibrationFamily[] {
  const families = new Set<ReplaySemanticCalibrationFamily>();

  for (const entry of entries) {
    for (const family of deriveSemanticFamiliesForDifference(
      entry.focusArea,
      entry.apertureValue,
      entry.expectedValue,
    )) {
      families.add(family);
    }
  }

  return [...families].sort();
}

export function deriveSemanticFamiliesForDifference(
  focusArea: OfflineReviewFocusArea,
  apertureValue: string | string[] | boolean | null,
  expectedValue: string | string[] | boolean | null,
): ReplaySemanticCalibrationFamily[] {
  switch (focusArea) {
    case "ask": {
      const current = readAskKind(apertureValue);
      const expected = readAskKind(expectedValue);
      if (current === null || expected === null) {
        return [];
      }
      const currentAskLike = current !== "status" && current !== "none";
      const expectedAskLike = expected !== "status" && expected !== "none";
      if (currentAskLike && !expectedAskLike) {
        return ["ask_overread"];
      }
      if (!currentAskLike && expectedAskLike) {
        return ["ask_missed"];
      }
      return [];
    }
    case "blocking":
      return ["blocking_missed"];
    case "episode":
      return ["episode_missed"];
    case "confidence": {
      const current = readConfidenceLevel(apertureValue);
      const expected = readConfidenceLevel(expectedValue);
      if (current === null || expected === null) {
        return [];
      }
      const currentRank = confidenceRank(current);
      const expectedRank = confidenceRank(expected);
      if (currentRank > expectedRank) {
        return ["confidence_too_high"];
      }
      if (currentRank < expectedRank) {
        return ["confidence_too_low"];
      }
      return [];
    }
    case "consequence": {
      const current = readConsequenceLevel(apertureValue);
      const expected = readConsequenceLevel(expectedValue);
      if (current === null || expected === null) {
        return [];
      }
      const currentRank = consequenceRank(current);
      const expectedRank = consequenceRank(expected);
      if (currentRank > expectedRank) {
        return ["consequence_overread"];
      }
      if (currentRank < expectedRank) {
        return ["consequence_underread"];
      }
      return [];
    }
    case "intentFrame": {
      const current = readIntentFrame(apertureValue);
      const expected = readIntentFrame(expectedValue);
      if (current === null || expected === null) {
        return [];
      }
      const currentAskLike = isAskLikeIntentFrame(current);
      const expectedAskLike = isAskLikeIntentFrame(expected);
      if (currentAskLike && !expectedAskLike) {
        return ["ask_overread"];
      }
      if (!currentAskLike && expectedAskLike) {
        return ["ask_missed"];
      }
      return [];
    }
    default:
      return [];
  }
}

export async function readJsonFilesRecursive(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }

  const filePaths: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...await readJsonFilesRecursive(absolutePath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      filePaths.push(absolutePath);
    }
  }

  return filePaths.sort();
}

function readConfidenceLevel(
  value: string | string[] | boolean | null,
): OfflineReviewConfidence | null {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return null;
}

function readAskKind(
  value: string | string[] | boolean | null,
): "approval" | "choice" | "form" | "status" | "none" | null {
  if (
    value === "approval"
    || value === "choice"
    || value === "form"
    || value === "status"
    || value === "none"
  ) {
    return value;
  }
  return null;
}

function readConsequenceLevel(
  value: string | string[] | boolean | null,
): "low" | "medium" | "high" | null {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const annotated = trimmed.match(/^(low|medium|high) consequence\s*;/);
    if (annotated?.[1] === "low" || annotated?.[1] === "medium" || annotated?.[1] === "high") {
      return annotated[1];
    }
  }

  return null;
}

function consequenceRank(value: "low" | "medium" | "high"): number {
  switch (value) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
  }
}

function readIntentFrame(
  value: string | string[] | boolean | null,
): string | null {
  return typeof value === "string" ? value : null;
}

function isAskLikeIntentFrame(value: string): boolean {
  return value === "approval_request"
    || value === "question_request"
    || value === "form_request";
}

function isMissingDirectoryError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
