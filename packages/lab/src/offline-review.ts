import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SemanticConfidence, SemanticConsequenceLevel, SemanticIntentFrame } from "@tomismeta/aperture-core/semantic";

import type { ReplayDecisionSnapshot, ReplayObservationStep, ReplaySemanticSnapshot } from "./scenario.js";
import type { ReplaySessionBundle, ReplaySessionBundleSource } from "./session-bundle.js";
import { isRecord, isStringArray } from "./validation.js";

export const OFFLINE_REVIEW_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const OFFLINE_REVIEW_REPORT_SCHEMA_VERSION = 1 as const;
export const OFFLINE_REVIEW_RECOMMENDATION_SCHEMA_VERSION = 1 as const;
export const OFFLINE_REVIEW_RUN_SCHEMA_VERSION = 1 as const;
export const DEFAULT_OFFLINE_REVIEW_RUBRIC_VERSION = "offline-ai-review-v1" as const;
export const DEFAULT_OFFLINE_REVIEW_RESULTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../results/offline-review",
);
export const DEFAULT_OFFLINE_REVIEW_REQUESTS_DIR = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "requests",
);
export const DEFAULT_OFFLINE_REVIEW_PROMPT_DIR = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "prompts",
);
export const DEFAULT_OFFLINE_REVIEW_RAW_DIR = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "raw",
);
export const DEFAULT_OFFLINE_REVIEW_RESPONSES_DIR = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "responses",
);
export const DEFAULT_OFFLINE_REVIEW_DISAGREEMENTS_DIR = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "disagreements",
);
export const DEFAULT_OFFLINE_REVIEW_RUNS_DIR = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "runs",
);
export const DEFAULT_OFFLINE_REVIEW_RECOMMENDATIONS_DIR = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "recommendations",
);
export const DEFAULT_OFFLINE_REVIEW_RESULTS_LOG_PATH = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "results.tsv",
);

export const DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS = [
  "title",
  "summary",
  "status",
  "intentFrame",
  "toolFamily",
  "consequence",
] as const satisfies readonly OfflineReviewFocusArea[];

export type OfflineReviewFocusArea =
  | "title"
  | "summary"
  | "status"
  | "intentFrame"
  | "toolFamily"
  | "consequence";

export type OfflineReviewConfidence = SemanticConfidence;

export type OfflineReviewRecommendation = "promote" | "inspect" | "ignore";
export type OfflineReviewRunStatus = "clean" | "disagreement";
export type OfflineReviewRecommendationOwner = "importer" | "semantic";

export type OfflineReviewPreparedStep = {
  stepIndex: number;
  stepKind: ReplayObservationStep["kind"];
  stepLabel?: string;
  sourceExcerpt: string | null;
  sourceEvent: {
    type: string;
    title: string | null;
    summary: string | null;
    status: string | null;
    toolFamily: string | null;
  } | null;
  normalizedEvent: {
    type: string;
    title: string | null;
    summary: string | null;
    status: string | null;
    toolFamily: string | null;
  } | null;
  apertureRead: {
    intentFrame: SemanticIntentFrame | null;
    toolFamily: string | null;
    consequence: SemanticConsequenceLevel | null;
    confidence: SemanticConfidence | null;
    abstained: boolean;
    whyNow: string | null;
    relationKinds: string[];
  } | null;
  apertureDecision: {
    evaluationKind: ReplayDecisionSnapshot["evaluationKind"];
    decisionKind: ReplayDecisionSnapshot["decisionKind"] | null;
    resultBucket: ReplayDecisionSnapshot["resultBucket"] | null;
    semanticInfluence: string[];
  } | null;
};

export type OfflineReviewFinding = {
  stepIndex: number;
  focusArea: OfflineReviewFocusArea;
  expected: string | string[] | boolean | null;
  confidence: OfflineReviewConfidence;
  supportingText?: string;
  rationale?: string;
  recommendation?: OfflineReviewRecommendation;
};

export type OfflineReviewArtifact = {
  schemaVersion: typeof OFFLINE_REVIEW_ARTIFACT_SCHEMA_VERSION;
  generatedAt: string;
  rubricVersion: string;
  bundle: {
    sessionId: string;
    title: string;
    description?: string;
    bundlePath?: string;
    source?: ReplaySessionBundleSource;
  };
  focusAreas: OfflineReviewFocusArea[];
  instructions: string[];
  steps: OfflineReviewPreparedStep[];
  review: {
    reviewer?: string;
    model?: string;
    completedAt?: string;
    notes?: string;
    findings: OfflineReviewFinding[];
  };
};

export type OfflineReviewResponsePayload = {
  review: OfflineReviewArtifact["review"];
};

export type OfflineReviewDisagreement = {
  stepIndex: number;
  stepLabel?: string;
  focusArea: OfflineReviewFocusArea;
  apertureValue: string | string[] | boolean | null;
  expectedValue: string | string[] | boolean | null;
  confidence: OfflineReviewConfidence;
  supportingText?: string;
  rationale?: string;
  recommendation: OfflineReviewRecommendation;
};

export type OfflineReviewReport = {
  schemaVersion: typeof OFFLINE_REVIEW_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  rubricVersion: string;
  bundle: OfflineReviewArtifact["bundle"];
  review: {
    reviewer?: string;
    model?: string;
    completedAt?: string;
    notes?: string;
  };
  summary: {
    totalFindings: number;
    disagreementCount: number;
    matchedFindings: number;
    disagreementsByFocusArea: Record<OfflineReviewFocusArea, number>;
  };
  disagreements: OfflineReviewDisagreement[];
};

export type OfflineReviewRecommendationItem = {
  focusArea: OfflineReviewFocusArea;
  owner: OfflineReviewRecommendationOwner;
  targets: string[];
  recommendation: OfflineReviewRecommendation;
  disagreementCount: number;
  confidenceCounts: Record<OfflineReviewConfidence, number>;
  summary: string;
  examples: Array<{
    stepIndex: number;
    stepLabel?: string;
    apertureValue: string | string[] | boolean | null;
    expectedValue: string | string[] | boolean | null;
    confidence: OfflineReviewConfidence;
    recommendation: OfflineReviewRecommendation;
  }>;
};

export type OfflineReviewRecommendationReport = {
  schemaVersion: typeof OFFLINE_REVIEW_RECOMMENDATION_SCHEMA_VERSION;
  generatedAt: string;
  rubricVersion: string;
  status: OfflineReviewRunStatus;
  bundle: OfflineReviewArtifact["bundle"];
  review: OfflineReviewReport["review"];
  summary: {
    disagreementCount: number;
    actionableCount: number;
    recommendationCounts: Record<OfflineReviewRecommendation, number>;
  };
  items: OfflineReviewRecommendationItem[];
};

export type OfflineReviewRun = {
  schemaVersion: typeof OFFLINE_REVIEW_RUN_SCHEMA_VERSION;
  generatedAt: string;
  status: OfflineReviewRunStatus;
  bundle: OfflineReviewArtifact["bundle"];
  review: OfflineReviewReport["review"];
  summary: {
    totalFindings: number;
    disagreementCount: number;
    matchedFindings: number;
    actionableCount: number;
  };
  artifacts: {
    requestPath: string;
    promptPath?: string;
    rawResponsePath?: string;
    responsePath: string;
    reportPath: string;
    reportMarkdownPath: string;
    recommendationPath: string;
    recommendationMarkdownPath: string;
    runPath?: string;
  };
};

export function prepareOfflineReviewArtifact(
  bundle: ReplaySessionBundle,
  options: {
    bundlePath?: string;
    focusAreas?: readonly OfflineReviewFocusArea[];
    rubricVersion?: string;
    generatedAt?: string;
  } = {},
): OfflineReviewArtifact {
  const focusAreas = [...(options.focusAreas ?? DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS)];
  const steps = buildPreparedSteps(bundle);

  return {
    schemaVersion: OFFLINE_REVIEW_ARTIFACT_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    rubricVersion: options.rubricVersion ?? DEFAULT_OFFLINE_REVIEW_RUBRIC_VERSION,
    bundle: {
      sessionId: bundle.sessionId,
      title: bundle.title,
      ...(bundle.description !== undefined ? { description: bundle.description } : {}),
      ...(options.bundlePath !== undefined ? { bundlePath: options.bundlePath } : {}),
      ...(bundle.source !== undefined ? { source: bundle.source } : {}),
    },
    focusAreas,
    instructions: [
      "Review only the source excerpt and Aperture's current read for each step.",
      "Add findings only when Aperture appears materially wrong or importantly incomplete.",
      "Use supportingText to quote or paraphrase the exact source evidence for the disagreement.",
      "Prefer promote for crisp, benchmark-worthy misses; inspect for plausible misses that still need human review.",
    ],
    steps,
    review: {
      findings: [],
    },
  };
}

export function compareOfflineReviewArtifact(
  artifact: OfflineReviewArtifact,
  options: { generatedAt?: string } = {},
): OfflineReviewReport {
  const disagreements: OfflineReviewDisagreement[] = [];
  let matchedFindings = 0;
  const disagreementsByFocusArea = createFocusAreaCounts();

  for (const finding of artifact.review.findings) {
    const step = artifact.steps.find((entry) => entry.stepIndex === finding.stepIndex);
    if (!step) {
      throw new Error(`Offline review finding references missing step ${finding.stepIndex}.`);
    }

    const apertureValue = readOfflineReviewFocusAreaValue(step, finding.focusArea);
    if (offlineReviewValuesEqual(apertureValue, finding.expected)) {
      matchedFindings += 1;
      continue;
    }

    disagreements.push({
      stepIndex: step.stepIndex,
      ...(step.stepLabel ? { stepLabel: step.stepLabel } : {}),
      focusArea: finding.focusArea,
      apertureValue,
      expectedValue: finding.expected,
      confidence: finding.confidence,
      ...(finding.supportingText ? { supportingText: finding.supportingText } : {}),
      ...(finding.rationale ? { rationale: finding.rationale } : {}),
      recommendation: finding.recommendation ?? defaultRecommendation(finding.confidence),
    });
    disagreementsByFocusArea[finding.focusArea] += 1;
  }

  return {
    schemaVersion: OFFLINE_REVIEW_REPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    rubricVersion: artifact.rubricVersion,
    bundle: artifact.bundle,
    review: {
      ...(artifact.review.reviewer ? { reviewer: artifact.review.reviewer } : {}),
      ...(artifact.review.model ? { model: artifact.review.model } : {}),
      ...(artifact.review.completedAt ? { completedAt: artifact.review.completedAt } : {}),
      ...(artifact.review.notes ? { notes: artifact.review.notes } : {}),
    },
    summary: {
      totalFindings: artifact.review.findings.length,
      disagreementCount: disagreements.length,
      matchedFindings,
      disagreementsByFocusArea,
    },
    disagreements,
  };
}

export function parseOfflineReviewResponseText(raw: string): OfflineReviewResponsePayload {
  const candidate = extractJsonCandidate(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(
      `Failed to parse offline review response JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const artifact = validateOfflineReviewArtifact(parsed);
  if (artifact) {
    return { review: artifact.review };
  }

  const payload = validateOfflineReviewResponsePayload(parsed);
  if (!payload) {
    throw new Error("Invalid offline review response payload.");
  }

  return payload;
}

export function applyOfflineReviewResponse(
  artifact: OfflineReviewArtifact,
  response: OfflineReviewResponsePayload,
): OfflineReviewArtifact {
  return {
    ...artifact,
    review: {
      ...(response.review.reviewer ? { reviewer: response.review.reviewer } : {}),
      ...(response.review.model ? { model: response.review.model } : {}),
      ...(response.review.completedAt ? { completedAt: response.review.completedAt } : {}),
      ...(response.review.notes ? { notes: response.review.notes } : {}),
      findings: response.review.findings.map((finding) => ({ ...finding })),
    },
  };
}

export function buildOfflineReviewRecommendationReport(
  report: OfflineReviewReport,
  options: { generatedAt?: string } = {},
): OfflineReviewRecommendationReport {
  const grouped = new Map<OfflineReviewFocusArea, OfflineReviewDisagreement[]>();
  for (const disagreement of report.disagreements) {
    const list = grouped.get(disagreement.focusArea) ?? [];
    list.push(disagreement);
    grouped.set(disagreement.focusArea, list);
  }

  const items = [...grouped.entries()]
    .map(([focusArea, disagreements]) => buildRecommendationItem(focusArea, disagreements))
    .sort((left, right) => compareRecommendationItems(left, right));

  const recommendationCounts = createRecommendationCounts();
  let actionableCount = 0;
  for (const disagreement of report.disagreements) {
    recommendationCounts[disagreement.recommendation] += 1;
    if (disagreement.recommendation !== "ignore") {
      actionableCount += 1;
    }
  }

  return {
    schemaVersion: OFFLINE_REVIEW_RECOMMENDATION_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    rubricVersion: report.rubricVersion,
    status: report.summary.disagreementCount > 0 ? "disagreement" : "clean",
    bundle: report.bundle,
    review: report.review,
    summary: {
      disagreementCount: report.summary.disagreementCount,
      actionableCount,
      recommendationCounts,
    },
    items,
  };
}

export function createOfflineReviewRun(
  report: OfflineReviewReport,
  recommendation: OfflineReviewRecommendationReport,
  artifacts: OfflineReviewRun["artifacts"],
  options: { generatedAt?: string } = {},
): OfflineReviewRun {
  return {
    schemaVersion: OFFLINE_REVIEW_RUN_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    status: report.summary.disagreementCount > 0 ? "disagreement" : "clean",
    bundle: report.bundle,
    review: report.review,
    summary: {
      totalFindings: report.summary.totalFindings,
      disagreementCount: report.summary.disagreementCount,
      matchedFindings: report.summary.matchedFindings,
      actionableCount: recommendation.summary.actionableCount,
    },
    artifacts,
  };
}

export function renderOfflineReviewReportMarkdown(report: OfflineReviewReport): string {
  const lines = [
    "# Offline Review Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Bundle: ${report.bundle.sessionId}`,
    `Rubric: ${report.rubricVersion}`,
    "",
    "## Summary",
    "",
    `- Total findings: ${report.summary.totalFindings}`,
    `- Disagreements: ${report.summary.disagreementCount}`,
    `- Matched findings: ${report.summary.matchedFindings}`,
    "",
    "## Focus Areas",
    "",
  ];

  for (const focusArea of DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS) {
    lines.push(`- ${focusArea}: ${report.summary.disagreementsByFocusArea[focusArea] ?? 0}`);
  }

  lines.push("", "## Disagreements", "");

  if (report.disagreements.length === 0) {
    lines.push("- none", "");
    return `${lines.join("\n")}\n`;
  }

  for (const disagreement of report.disagreements) {
    lines.push(
      `- step ${disagreement.stepIndex}${disagreement.stepLabel ? ` (${disagreement.stepLabel})` : ""}: ${disagreement.focusArea}`,
      `  - Aperture: ${renderValue(disagreement.apertureValue)}`,
      `  - Expected: ${renderValue(disagreement.expectedValue)}`,
      `  - Confidence: ${disagreement.confidence}`,
      `  - Recommendation: ${disagreement.recommendation}`,
    );
    if (disagreement.supportingText) {
      lines.push(`  - Evidence: ${disagreement.supportingText}`);
    }
    if (disagreement.rationale) {
      lines.push(`  - Rationale: ${disagreement.rationale}`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderOfflineReviewRecommendationMarkdown(
  report: OfflineReviewRecommendationReport,
): string {
  const lines = [
    "# Offline Review Recommendations",
    "",
    `Generated: ${report.generatedAt}`,
    `Bundle: ${report.bundle.sessionId}`,
    `Status: ${report.status}`,
    "",
    "## Summary",
    "",
    `- Disagreements: ${report.summary.disagreementCount}`,
    `- Actionable: ${report.summary.actionableCount}`,
    `- Promote: ${report.summary.recommendationCounts.promote}`,
    `- Inspect: ${report.summary.recommendationCounts.inspect}`,
    `- Ignore: ${report.summary.recommendationCounts.ignore}`,
    "",
    "## Recommendations",
    "",
  ];

  if (report.items.length === 0) {
    lines.push("- none", "");
    return `${lines.join("\n")}\n`;
  }

  for (const item of report.items) {
    lines.push(
      `- ${item.focusArea}: ${item.summary}`,
      `  - Recommendation: ${item.recommendation}`,
      `  - Owner: ${item.owner}`,
      `  - Targets: ${item.targets.join(", ")}`,
      `  - Disagreements: ${item.disagreementCount}`,
      `  - Confidence: high=${item.confidenceCounts.high}, medium=${item.confidenceCounts.medium}, low=${item.confidenceCounts.low}`,
    );

    for (const example of item.examples) {
      lines.push(
        `  - Example step ${example.stepIndex}${example.stepLabel ? ` (${example.stepLabel})` : ""}: Aperture=${renderValue(example.apertureValue)} expected=${renderValue(example.expectedValue)} (${example.confidence}, ${example.recommendation})`,
      );
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderOfflineReviewPrompt(artifact: OfflineReviewArtifact): string {
  const lines = [
    "# Aperture Offline Review Prompt",
    "",
    "You are reviewing Aperture's deterministic semantic and decision read for one replay bundle.",
    "",
    "Your job is to add findings only when Aperture appears materially wrong or importantly incomplete.",
    "",
    "## Output Rules",
    "",
    "- Return valid JSON only.",
    "- The JSON must contain exactly one top-level object with a `review` field.",
    "- Preserve any existing `review` metadata unless you are intentionally updating it.",
    "- Put findings into `review.findings`.",
    "- Do not rewrite the prepared `steps` data.",
    "",
    "## Finding Rules",
    "",
    "- Add a finding only when you see a meaningful disagreement.",
    "- Each finding must include:",
    "  - `stepIndex`",
    "  - `focusArea`",
    "  - `expected`",
    "  - `confidence`",
    "- Prefer high-confidence findings with concrete evidence.",
    "- Use `supportingText` to cite or paraphrase the exact source evidence.",
    "- Use `recommendation`:",
    "  - `promote` for crisp benchmark-worthy misses",
    "  - `inspect` for plausible misses needing human review",
    "  - `ignore` for low-confidence or weak disagreements",
    "",
    "## Focus Areas",
    "",
    `- ${artifact.focusAreas.join(", ")}`,
    "",
    "## Prepared Artifact",
    "",
    "```json",
    JSON.stringify(artifact, null, 2),
    "```",
    "",
    "## Required Response Shape",
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
  ];

  return `${lines.join("\n")}\n`;
}

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

export function validateOfflineReviewArtifact(value: unknown): OfflineReviewArtifact | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.schemaVersion !== OFFLINE_REVIEW_ARTIFACT_SCHEMA_VERSION
    || typeof value.generatedAt !== "string"
    || typeof value.rubricVersion !== "string"
    || !isRecord(value.bundle)
    || typeof value.bundle.sessionId !== "string"
    || typeof value.bundle.title !== "string"
    || !Array.isArray(value.focusAreas)
    || !value.focusAreas.every((area) => isOfflineReviewFocusArea(area))
    || !Array.isArray(value.instructions)
    || !isStringArray(value.instructions)
    || !Array.isArray(value.steps)
    || !value.steps.every((step) => validatePreparedStep(step) !== null)
    || !isRecord(value.review)
    || !Array.isArray(value.review.findings)
    || !value.review.findings.every((finding) => validateOfflineReviewFinding(finding) !== null)
  ) {
    return null;
  }

  if (
    (value.bundle.description !== undefined && typeof value.bundle.description !== "string")
    || (value.bundle.bundlePath !== undefined && typeof value.bundle.bundlePath !== "string")
    || (value.bundle.source !== undefined && validateReviewBundleSource(value.bundle.source) === null)
    || (value.review.reviewer !== undefined && typeof value.review.reviewer !== "string")
    || (value.review.model !== undefined && typeof value.review.model !== "string")
    || (value.review.completedAt !== undefined && typeof value.review.completedAt !== "string")
    || (value.review.notes !== undefined && typeof value.review.notes !== "string")
  ) {
    return null;
  }

  return value as OfflineReviewArtifact;
}

function buildPreparedSteps(bundle: ReplaySessionBundle): OfflineReviewPreparedStep[] {
  return bundle.steps.map((step, stepIndex) => {
    const normalized = bundle.normalizedEvents.find((snapshot) => snapshot.stepIndex === stepIndex);
    const semantic = bundle.semanticSnapshots.find((snapshot) => snapshot.stepIndex === stepIndex);
    const decision = bundle.decisionSnapshots.find((snapshot) => snapshot.stepIndex === stepIndex);

    return {
      stepIndex,
      stepKind: step.kind,
      ...(step.label ? { stepLabel: step.label } : {}),
      sourceExcerpt: buildSourceExcerpt(step),
      sourceEvent: buildSourceEventSummary(step),
      normalizedEvent: normalized
        ? {
            type: normalized.event.type,
            title: readEventTitle(normalized.event),
            summary: readEventSummary(normalized.event),
            status: readEventStatus(normalized.event),
            toolFamily: readEventToolFamily(normalized.event),
          }
        : null,
      apertureRead: semantic ? buildSemanticSummary(semantic) : null,
      apertureDecision: decision
        ? {
            evaluationKind: decision.evaluationKind,
            decisionKind: decision.decisionKind ?? null,
            resultBucket: decision.resultBucket ?? null,
            semanticInfluence: [...(decision.semanticInfluence ?? [])],
          }
        : null,
    };
  });
}

function buildSourceExcerpt(step: ReplayObservationStep): string | null {
  switch (step.kind) {
    case "publishSource":
      return compactText([readEventTitle(step.event), readEventSummary(step.event)].filter(isNonEmptyString).join(" — "));
    case "publish":
      return compactText([readEventTitle(step.event), readEventSummary(step.event)].filter(isNonEmptyString).join(" — "));
    case "submit":
      return compactText(`response:${step.response.response.kind}`);
    case "signal":
      return compactText(`signal:${step.signal.kind}`);
    default:
      return step.label ?? null;
  }
}

function buildSourceEventSummary(step: ReplayObservationStep): OfflineReviewPreparedStep["sourceEvent"] {
  if (step.kind !== "publishSource" && step.kind !== "publish") {
    return null;
  }

  const event = step.event;
  return {
    type: event.type,
    title: readEventTitle(event),
    summary: readEventSummary(event),
    status: readEventStatus(event),
    toolFamily: readEventToolFamily(event),
  };
}

function buildSemanticSummary(snapshot: ReplaySemanticSnapshot): NonNullable<OfflineReviewPreparedStep["apertureRead"]> {
  return {
    intentFrame: snapshot.interpretation.intentFrame ?? null,
    toolFamily: snapshot.interpretation.toolFamily ?? null,
    consequence: snapshot.interpretation.consequence ?? null,
    confidence: snapshot.interpretation.confidence ?? null,
    abstained: snapshot.interpretation.abstained ?? false,
    whyNow: snapshot.interpretation.whyNow ?? null,
    relationKinds: snapshot.interpretation.relationHints.map((hint) => hint.kind),
  };
}

export function readOfflineReviewFocusAreaValue(
  step: OfflineReviewPreparedStep,
  focusArea: OfflineReviewFocusArea,
): string | string[] | boolean | null {
  switch (focusArea) {
    case "title":
      return step.sourceEvent?.title ?? step.normalizedEvent?.title ?? null;
    case "summary":
      return step.sourceEvent?.summary ?? step.normalizedEvent?.summary ?? null;
    case "status":
      return step.normalizedEvent?.status ?? step.sourceEvent?.status ?? null;
    case "intentFrame":
      return step.apertureRead?.intentFrame ?? null;
    case "toolFamily":
      return step.apertureRead?.toolFamily ?? null;
    case "consequence":
      return step.apertureRead?.consequence ?? null;
  }
}

export function offlineReviewValuesEqual(
  left: string | string[] | boolean | null,
  right: string | string[] | boolean | null,
): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    return [...left].sort().every((value, index) => value === [...right].sort()[index]);
  }

  return normalizeOfflineReviewScalar(left) === normalizeOfflineReviewScalar(right);
}

function normalizeOfflineReviewScalar(value: string | boolean | null): string | boolean | null {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  const annotatedConsequence = trimmed.match(/^(low|medium|high) consequence\s*;/);
  if (annotatedConsequence?.[1]) {
    return annotatedConsequence[1];
  }

  return trimmed;
}

function renderValue(value: string | string[] | boolean | null): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : value.join(", ");
  }
  if (value === null) {
    return "null";
  }
  return String(value);
}

function defaultRecommendation(confidence: OfflineReviewConfidence): OfflineReviewRecommendation {
  return confidence === "high" ? "promote" : confidence === "medium" ? "inspect" : "ignore";
}

function createFocusAreaCounts(): Record<OfflineReviewFocusArea, number> {
  return {
    title: 0,
    summary: 0,
    status: 0,
    intentFrame: 0,
    toolFamily: 0,
    consequence: 0,
  };
}

function validatePreparedStep(value: unknown): OfflineReviewPreparedStep | null {
  if (!isRecord(value) || typeof value.stepIndex !== "number" || typeof value.stepKind !== "string") {
    return null;
  }

  if (
    (value.stepLabel !== undefined && typeof value.stepLabel !== "string")
    || !isNullableString(value.sourceExcerpt)
    || validatePreparedEventSummary(value.sourceEvent) === null
    || validatePreparedEventSummary(value.normalizedEvent) === null
    || validatePreparedRead(value.apertureRead) === null
    || validatePreparedDecision(value.apertureDecision) === null
  ) {
    return null;
  }

  return value as OfflineReviewPreparedStep;
}

function validatePreparedEventSummary(
  value: unknown,
): OfflineReviewPreparedStep["sourceEvent"] | null {
  if (value === null) {
    return value;
  }

  if (
    !isRecord(value)
    || typeof value.type !== "string"
    || !isNullableString(value.title)
    || !isNullableString(value.summary)
    || !isNullableString(value.status)
    || !isNullableString(value.toolFamily)
  ) {
    return null;
  }

  return value as OfflineReviewPreparedStep["sourceEvent"];
}

function validatePreparedRead(
  value: unknown,
): OfflineReviewPreparedStep["apertureRead"] | null {
  if (value === null) {
    return value;
  }

  if (
    !isRecord(value)
    || !isNullableString(value.intentFrame)
    || !isNullableString(value.toolFamily)
    || !isNullableString(value.consequence)
    || !isNullableString(value.confidence)
    || typeof value.abstained !== "boolean"
    || !isNullableString(value.whyNow)
    || !isStringArray(value.relationKinds)
  ) {
    return null;
  }

  return value as OfflineReviewPreparedStep["apertureRead"];
}

function validatePreparedDecision(
  value: unknown,
): OfflineReviewPreparedStep["apertureDecision"] | null {
  if (value === null) {
    return value;
  }

  if (
    !isRecord(value)
    || typeof value.evaluationKind !== "string"
    || !isNullableString(value.decisionKind)
    || !isNullableString(value.resultBucket)
    || !isStringArray(value.semanticInfluence)
  ) {
    return null;
  }

  return value as OfflineReviewPreparedStep["apertureDecision"];
}

function validateOfflineReviewFinding(value: unknown): OfflineReviewFinding | null {
  if (!isRecord(value) || typeof value.stepIndex !== "number" || !isOfflineReviewFocusArea(value.focusArea)) {
    return null;
  }

  if (
    !isOfflineReviewFindingExpected(value.expected)
    || !isOfflineReviewConfidence(value.confidence)
    || (value.supportingText !== undefined && typeof value.supportingText !== "string")
    || (value.rationale !== undefined && typeof value.rationale !== "string")
    || (value.recommendation !== undefined && !isOfflineReviewRecommendation(value.recommendation))
  ) {
    return null;
  }

  return value as OfflineReviewFinding;
}

function validateOfflineReviewResponsePayload(value: unknown): OfflineReviewResponsePayload | null {
  if (!isRecord(value) || !isRecord(value.review) || !Array.isArray(value.review.findings)) {
    return null;
  }

  if (
    !value.review.findings.every((finding) => validateOfflineReviewFinding(finding) !== null)
    || (value.review.reviewer !== undefined && typeof value.review.reviewer !== "string")
    || (value.review.model !== undefined && typeof value.review.model !== "string")
    || (value.review.completedAt !== undefined && typeof value.review.completedAt !== "string")
    || (value.review.notes !== undefined && typeof value.review.notes !== "string")
  ) {
    return null;
  }

  return value as OfflineReviewResponsePayload;
}

function validateReviewBundleSource(value: unknown): ReplaySessionBundleSource | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  if (
    (value.kind !== undefined && typeof value.kind !== "string")
    || (value.label !== undefined && typeof value.label !== "string")
    || (value.redacted !== undefined && typeof value.redacted !== "boolean")
    || (value.capture !== undefined && !validateReviewBundleCapture(value.capture))
  ) {
    return null;
  }

  return value as ReplaySessionBundleSource;
}

function validateReviewBundleCapture(value: unknown): boolean {
  return isRecord(value)
    && (value.eventTransport === undefined || typeof value.eventTransport === "string")
    && (value.semanticCapture === undefined || typeof value.semanticCapture === "string")
    && (value.responseBridge === undefined || typeof value.responseBridge === "string")
    && (value.notes === undefined || isStringArray(value.notes));
}

function buildRecommendationItem(
  focusArea: OfflineReviewFocusArea,
  disagreements: OfflineReviewDisagreement[],
): OfflineReviewRecommendationItem {
  const confidenceCounts = createConfidenceCounts();
  let recommendation: OfflineReviewRecommendation = "ignore";
  for (const disagreement of disagreements) {
    confidenceCounts[disagreement.confidence] += 1;
    if (compareRecommendationPriority(disagreement.recommendation, recommendation) < 0) {
      recommendation = disagreement.recommendation;
    }
  }

  return {
    focusArea,
    owner: focusAreaOwner(focusArea),
    targets: recommendationTargets(focusArea),
    recommendation,
    disagreementCount: disagreements.length,
    confidenceCounts,
    summary: recommendationSummary(focusArea),
    examples: disagreements.slice(0, 3).map((disagreement) => ({
      stepIndex: disagreement.stepIndex,
      ...(disagreement.stepLabel ? { stepLabel: disagreement.stepLabel } : {}),
      apertureValue: disagreement.apertureValue,
      expectedValue: disagreement.expectedValue,
      confidence: disagreement.confidence,
      recommendation: disagreement.recommendation,
    })),
  };
}

function compareRecommendationItems(
  left: OfflineReviewRecommendationItem,
  right: OfflineReviewRecommendationItem,
): number {
  const priority = compareRecommendationPriority(left.recommendation, right.recommendation);
  if (priority !== 0) {
    return priority;
  }
  return right.disagreementCount - left.disagreementCount;
}

function compareRecommendationPriority(
  left: OfflineReviewRecommendation,
  right: OfflineReviewRecommendation,
): number {
  const order: Record<OfflineReviewRecommendation, number> = {
    promote: 0,
    inspect: 1,
    ignore: 2,
  };
  return order[left] - order[right];
}

function createRecommendationCounts(): Record<OfflineReviewRecommendation, number> {
  return {
    promote: 0,
    inspect: 0,
    ignore: 0,
  };
}

function createConfidenceCounts(): Record<OfflineReviewConfidence, number> {
  return {
    high: 0,
    medium: 0,
    low: 0,
  };
}

function focusAreaOwner(
  focusArea: OfflineReviewFocusArea,
): OfflineReviewRecommendationOwner {
  switch (focusArea) {
    case "title":
    case "summary":
    case "status":
      return "importer";
    case "intentFrame":
    case "toolFamily":
    case "consequence":
      return "semantic";
  }
}

function recommendationTargets(focusArea: OfflineReviewFocusArea): string[] {
  switch (focusArea) {
    case "title":
    case "summary":
    case "status":
      return [
        "packages/lab/src/public-trajectories.ts",
        "packages/lab/src/offline-review.ts",
      ];
    case "intentFrame":
    case "toolFamily":
    case "consequence":
      return [
        "packages/core/src/semantic-detection.ts",
        "packages/core/src/semantic-interpreter.ts",
        "packages/core/src/semantic-language.ts",
      ];
  }
}

function recommendationSummary(focusArea: OfflineReviewFocusArea): string {
  switch (focusArea) {
    case "title":
      return "Tighten imported trajectory title extraction before replay review.";
    case "summary":
      return "Tighten imported trajectory summary extraction and compaction.";
    case "status":
      return "Review imported event-status mapping before it reaches the semantic layer.";
    case "intentFrame":
      return "Tighten semantic intent-frame reads on imported external events.";
    case "toolFamily":
      return "Tighten tool-family inference and preservation on imported events.";
    case "consequence":
      return "Tighten consequence-band calibration for imported external events.";
  }
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("Offline review response did not contain a JSON object.");
}

function readEventTitle(value: { type: string } & Record<string, unknown>): string | null {
  return typeof value.title === "string" ? value.title : null;
}

function readEventSummary(value: { type: string } & Record<string, unknown>): string | null {
  return typeof value.summary === "string" ? value.summary : null;
}

function readEventStatus(value: { type: string } & Record<string, unknown>): string | null {
  return typeof value.status === "string" ? value.status : null;
}

function readEventToolFamily(value: { type: string } & Record<string, unknown>): string | null {
  return typeof value.toolFamily === "string" ? value.toolFamily : null;
}

function isOfflineReviewFocusArea(value: unknown): value is OfflineReviewFocusArea {
  return value === "title"
    || value === "summary"
    || value === "status"
    || value === "intentFrame"
    || value === "toolFamily"
    || value === "consequence";
}

function isOfflineReviewConfidence(value: unknown): value is OfflineReviewConfidence {
  return value === "low" || value === "medium" || value === "high";
}

function isOfflineReviewRecommendation(value: unknown): value is OfflineReviewRecommendation {
  return value === "promote" || value === "inspect" || value === "ignore";
}

function isOfflineReviewFindingExpected(
  value: unknown,
): value is OfflineReviewFinding["expected"] {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || isStringArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function compactText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}
