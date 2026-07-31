import path from "node:path";

import type {
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticIntentFrame,
  SemanticOntologyAsk,
  SemanticOntologyBlocking,
  SemanticOntologyEpisode,
  SemanticOntologySource,
} from "@tomismeta/aperture-core/semantic";

import {
  DEFAULT_OFFLINE_REVIEW_RUBRIC_VERSION,
  OFFLINE_REVIEW_ARTIFACT_SCHEMA_VERSION,
  OFFLINE_REVIEW_REPORT_SCHEMA_VERSION,
  OFFLINE_REVIEW_RECOMMENDATION_SCHEMA_VERSION,
  OFFLINE_REVIEW_RUN_SCHEMA_VERSION,
} from "./artifact-versions.js";
import { extractJsonCandidate } from "./json-utils.js";
import type { ReplayDecisionSnapshot, ReplayObservationStep } from "./scenario.js";
import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";
import { isRecord } from "./shape.js";
import type { ReplaySessionBundle, ReplaySessionBundleSource } from "./session-bundle.js";
import {
  buildPreparedSteps as prepareStepsFromBundle,
  buildRecommendationItem as buildRecommendationItemFromDisagreements,
  compareRecommendationItems as compareRecommendationItemsByPriority,
  createFocusAreaCounts as createOfflineReviewFocusAreaCounts,
  createRecommendationCounts as createOfflineReviewRecommendationCounts,
  defaultRecommendation as defaultOfflineReviewRecommendation,
  offlineReviewValuesEqual as compareOfflineReviewValues,
  readOfflineReviewFocusAreaValue as readOfflineReviewFocusValue,
} from "./offline-review-support.js";
import {
  validateOfflineReviewArtifact as validateOfflineReviewArtifactShape,
  validateOfflineReviewResponsePayload as validateOfflineReviewResponsePayloadShape,
} from "./offline-review-validation.js";
import type { WorkflowTargetMetadataSummary } from "./workflow-metadata.js";

export {
  defaultOfflineReviewArtifactPath,
  defaultOfflineReviewPromptPath,
  defaultOfflineReviewRawResponsePath,
  defaultOfflineReviewRecommendationPath,
  defaultOfflineReviewReportPath,
  defaultOfflineReviewResponsePath,
  defaultOfflineReviewRunPath,
  loadOfflineReviewArtifact,
  writeOfflineReviewArtifact,
  writeOfflineReviewRecommendationReport,
  writeOfflineReviewReport,
  writeOfflineReviewRun,
} from "./offline-review-files.js";
export {
  buildOfflineReviewPromptPacket,
  renderOfflineReviewPrompt,
  renderOfflineReviewRecommendationMarkdown,
  renderOfflineReviewReportMarkdown,
} from "./offline-review-render.js";
export {
  DEFAULT_OFFLINE_REVIEW_RUBRIC_VERSION,
  OFFLINE_REVIEW_ARTIFACT_SCHEMA_VERSION,
  OFFLINE_REVIEW_REPORT_SCHEMA_VERSION,
  OFFLINE_REVIEW_RECOMMENDATION_SCHEMA_VERSION,
  OFFLINE_REVIEW_RUN_SCHEMA_VERSION,
} from "./artifact-versions.js";
export const DEFAULT_OFFLINE_REVIEW_RESULTS_DIR = path.resolve(
  DEFAULT_LAB_RUNTIME_ROOT,
  "results/offline-review",
);
export const DEFAULT_OFFLINE_REVIEW_REQUESTS_DIR = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "requests",
);
export const DEFAULT_OFFLINE_REVIEW_PROMPT_DIR = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "prompts",
);
export const DEFAULT_OFFLINE_REVIEW_RAW_DIR = path.join(DEFAULT_OFFLINE_REVIEW_RESULTS_DIR, "raw");
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
export const DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_STEPS = 18;
export const DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_STEPS = 6;
export const DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_CHARS = 16_000;
export const DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_EXCERPT_CHARS = 220;
export const DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_SUMMARY_CHARS = 160;
export const DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_TITLE_CHARS = 96;
export const DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_WHY_NOW_CHARS = 120;
export const DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_EXCERPT_CHARS = 96;
export const DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_SUMMARY_CHARS = 72;
export const DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_TITLE_CHARS = 64;
export const DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_WHY_NOW_CHARS = 60;

export const DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS = [
  "title",
  "summary",
  "status",
  "intentFrame",
  "toolFamily",
  "consequence",
  "blocking",
  "episode",
  "confidence",
] as const satisfies readonly OfflineReviewFocusArea[];

export const ALL_OFFLINE_REVIEW_FOCUS_AREAS = [
  ...DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS,
  "ask",
  "source",
] as const satisfies readonly OfflineReviewFocusArea[];

export type OfflineReviewFocusArea =
  | "title"
  | "summary"
  | "status"
  | "ask"
  | "intentFrame"
  | "toolFamily"
  | "consequence"
  | "blocking"
  | "episode"
  | "confidence"
  | "source";

export type OfflineReviewConfidence = SemanticConfidence;

export type OfflineReviewRecommendation = "promote" | "inspect" | "ignore";
export type OfflineReviewRunStatus = "clean" | "disagreement";
export type OfflineReviewRecommendationOwner = "importer" | "semantic";

const OFFLINE_REVIEW_CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "low",
] as const satisfies readonly OfflineReviewConfidence[];
const OFFLINE_REVIEW_RECOMMENDATIONS = [
  "promote",
  "inspect",
  "ignore",
] as const satisfies readonly OfflineReviewRecommendation[];
const OFFLINE_REVIEW_RECOMMENDATION_PRIORITY: Record<OfflineReviewRecommendation, number> = {
  promote: 0,
  inspect: 1,
  ignore: 2,
};
const OFFLINE_REVIEW_DEFAULT_RECOMMENDATION: Record<
  OfflineReviewConfidence,
  OfflineReviewRecommendation
> = {
  high: "promote",
  medium: "inspect",
  low: "ignore",
};
const OFFLINE_REVIEW_FOCUS_AREA_OWNER: Record<
  OfflineReviewFocusArea,
  OfflineReviewRecommendationOwner
> = {
  title: "importer",
  summary: "importer",
  status: "importer",
  ask: "semantic",
  intentFrame: "semantic",
  toolFamily: "semantic",
  consequence: "semantic",
  blocking: "semantic",
  episode: "semantic",
  confidence: "semantic",
  source: "semantic",
};
const OFFLINE_REVIEW_RECOMMENDATION_TARGETS: Record<OfflineReviewFocusArea, readonly string[]> = {
  title: ["packages/lab/src/public-trajectories.ts", "packages/lab/src/offline-review.ts"],
  summary: ["packages/lab/src/public-trajectories.ts", "packages/lab/src/offline-review.ts"],
  status: ["packages/lab/src/public-trajectories.ts", "packages/lab/src/offline-review.ts"],
  ask: ["packages/core/src/semantic-ontology.ts", "packages/core/src/semantic-interpreter.ts"],
  intentFrame: [
    "packages/core/src/semantic-detection.ts",
    "packages/core/src/semantic-interpreter.ts",
    "packages/core/src/semantic-language.ts",
  ],
  toolFamily: [
    "packages/core/src/semantic-detection.ts",
    "packages/core/src/semantic-interpreter.ts",
    "packages/core/src/semantic-language.ts",
  ],
  consequence: [
    "packages/core/src/semantic-detection.ts",
    "packages/core/src/semantic-interpreter.ts",
    "packages/core/src/semantic-language.ts",
    "packages/core/src/semantic-ontology.ts",
  ],
  blocking: ["packages/core/src/semantic-interpreter.ts", "packages/core/src/semantic-ontology.ts"],
  episode: [
    "packages/core/src/semantic-detection.ts",
    "packages/core/src/semantic-interpreter.ts",
    "packages/core/src/semantic-ontology.ts",
  ],
  confidence: [
    "packages/core/src/semantic-interpreter.ts",
    "packages/core/src/semantic-ontology.ts",
  ],
  source: ["packages/core/src/semantic-interpreter.ts", "packages/core/src/semantic-ontology.ts"],
};
const OFFLINE_REVIEW_RECOMMENDATION_SUMMARY: Record<OfflineReviewFocusArea, string> = {
  title: "Tighten imported trajectory title extraction before replay review.",
  summary: "Tighten imported trajectory summary extraction and compaction.",
  status: "Review imported event-status mapping before it reaches the semantic layer.",
  ask: "Tighten the canonical ask read on imported external events.",
  intentFrame: "Tighten semantic intent-frame reads on imported external events.",
  toolFamily: "Tighten tool-family inference and preservation on imported events.",
  consequence: "Tighten consequence-band calibration for imported external events.",
  blocking: "Tighten blocking-vs-waiting-vs-non-blocking reads on imported external events.",
  episode: "Tighten same-issue, resurfacing, and resolution reads on imported external events.",
  confidence: "Tighten confidence calibration for imported external events.",
  source: "Tighten explicit-vs-hinted-vs-inferred provenance reads on imported external events.",
};

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
    metadata?: Record<string, unknown> | null;
  } | null;
  normalizedEvent: {
    type: string;
    title: string | null;
    summary: string | null;
    status: string | null;
    toolFamily: string | null;
  } | null;
  apertureRead: {
    ask: SemanticOntologyAsk | null;
    intentFrame: SemanticIntentFrame | null;
    toolFamily: string | null;
    consequence: SemanticConsequenceLevel | null;
    blocking: SemanticOntologyBlocking | null;
    episode: SemanticOntologyEpisode | null;
    confidence: SemanticConfidence | null;
    source: SemanticOntologySource | null;
    abstained: boolean;
    whyNow: string | null;
    relationKinds: string[];
  } | null;
  apertureDecision: {
    evaluationKind: ReplayDecisionSnapshot["evaluationKind"];
    decisionKind: ReplayDecisionSnapshot["decisionKind"] | null;
    resultLane: ReplayDecisionSnapshot["resultLane"] | null;
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
    explanation?: ReplaySessionBundle["explanation"];
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

export type OfflineReviewPromptStep = {
  stepIndex: number;
  stepKind: ReplayObservationStep["kind"];
  stepLabel?: string;
  sourceExcerpt?: string;
  sourceEvent?: OfflineReviewPreparedStep["sourceEvent"];
  normalizedEvent?: OfflineReviewPreparedStep["normalizedEvent"];
  apertureRead?: OfflineReviewPreparedStep["apertureRead"];
  apertureDecision?: OfflineReviewPreparedStep["apertureDecision"];
};

export type OfflineReviewPromptPacket = {
  bundle: {
    sessionId: string;
    title: string;
    description?: string;
    sourceId?: string;
    sourceLabel?: string;
    explanationHeadline?: string;
    explanationWhyNow?: string;
    targetMetadataSummary?: WorkflowTargetMetadataSummary;
    targetLane?: "now" | "next" | "ambient" | "none";
    routingAuthority?: "status" | "request" | "event" | null;
  };
  focusAreas: OfflineReviewFocusArea[];
  packet: {
    originalStepCount: number;
    includedStepCount: number;
    omittedStepCount: number;
    compaction: "deterministic";
  };
  steps: OfflineReviewPromptStep[];
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
  const steps = prepareStepsFromBundle(bundle);

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
      ...(bundle.explanation !== undefined ? { explanation: bundle.explanation } : {}),
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
  const disagreementsByFocusArea = createOfflineReviewFocusAreaCounts(
    ALL_OFFLINE_REVIEW_FOCUS_AREAS,
  );

  for (const finding of artifact.review.findings) {
    const step = artifact.steps.find((entry) => entry.stepIndex === finding.stepIndex);
    if (!step) {
      throw new Error(`Offline review finding references missing step ${finding.stepIndex}.`);
    }

    const apertureValue = readOfflineReviewFocusValue(step, finding.focusArea);
    if (compareOfflineReviewValues(apertureValue, finding.expected)) {
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
      recommendation:
        finding.recommendation ??
        defaultOfflineReviewRecommendation(
          finding.confidence,
          OFFLINE_REVIEW_DEFAULT_RECOMMENDATION,
        ),
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
  const candidate = extractJsonCandidate(raw, {
    validators: [
      (value) =>
        validateOfflineReviewArtifactShape(value, {
          artifactSchemaVersion: OFFLINE_REVIEW_ARTIFACT_SCHEMA_VERSION,
          allFocusAreas: ALL_OFFLINE_REVIEW_FOCUS_AREAS,
          confidenceLevels: OFFLINE_REVIEW_CONFIDENCE_LEVELS,
          recommendations: OFFLINE_REVIEW_RECOMMENDATIONS,
        }) !== null,
      (value) =>
        validateOfflineReviewResponsePayloadShape(value, {
          allFocusAreas: ALL_OFFLINE_REVIEW_FOCUS_AREAS,
          confidenceLevels: OFFLINE_REVIEW_CONFIDENCE_LEVELS,
          recommendations: OFFLINE_REVIEW_RECOMMENDATIONS,
        }) !== null,
    ],
    fallbackValidator: (value) =>
      isRecord(value) && isRecord(value.review) && Array.isArray(value.review.findings),
  });
  if (!candidate) {
    throw new Error("Offline review response did not contain a JSON object.");
  }
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

  const payload = validateOfflineReviewResponsePayloadShape(parsed, {
    allFocusAreas: ALL_OFFLINE_REVIEW_FOCUS_AREAS,
    confidenceLevels: OFFLINE_REVIEW_CONFIDENCE_LEVELS,
    recommendations: OFFLINE_REVIEW_RECOMMENDATIONS,
  });
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
    .map(([focusArea, disagreements]) =>
      buildRecommendationItemFromDisagreements(focusArea, disagreements, {
        confidenceLevels: OFFLINE_REVIEW_CONFIDENCE_LEVELS,
        ownerByFocusArea: OFFLINE_REVIEW_FOCUS_AREA_OWNER,
        targetsByFocusArea: OFFLINE_REVIEW_RECOMMENDATION_TARGETS,
        summaryByFocusArea: OFFLINE_REVIEW_RECOMMENDATION_SUMMARY,
        priorityByRecommendation: OFFLINE_REVIEW_RECOMMENDATION_PRIORITY,
      }),
    )
    .sort((left, right) =>
      compareRecommendationItemsByPriority(left, right, OFFLINE_REVIEW_RECOMMENDATION_PRIORITY),
    );

  const recommendationCounts = createOfflineReviewRecommendationCounts(
    OFFLINE_REVIEW_RECOMMENDATIONS,
  );
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

export function validateOfflineReviewArtifact(value: unknown): OfflineReviewArtifact | null {
  return validateOfflineReviewArtifactShape(value, {
    artifactSchemaVersion: OFFLINE_REVIEW_ARTIFACT_SCHEMA_VERSION,
    allFocusAreas: ALL_OFFLINE_REVIEW_FOCUS_AREAS,
    confidenceLevels: OFFLINE_REVIEW_CONFIDENCE_LEVELS,
    recommendations: OFFLINE_REVIEW_RECOMMENDATIONS,
  });
}

export function readOfflineReviewFocusAreaValue(
  step: OfflineReviewPreparedStep,
  focusArea: OfflineReviewFocusArea,
): string | string[] | boolean | null {
  return readOfflineReviewFocusValue(step, focusArea);
}

export function offlineReviewValuesEqual(
  left: string | string[] | boolean | null,
  right: string | string[] | boolean | null,
): boolean {
  return compareOfflineReviewValues(left, right);
}
