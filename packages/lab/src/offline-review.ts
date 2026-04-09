import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  readSemanticOntologyDiagnostic,
  type SemanticConfidence,
  type SemanticConsequenceLevel,
  type SemanticIntentFrame,
  type SemanticOntologyAsk,
  type SemanticOntologyBlocking,
  type SemanticOntologyEpisode,
  type SemanticOntologySource,
} from "@tomismeta/aperture-core/semantic";

import { extractJsonCandidate } from "./json-utils.js";
import type { ReplayDecisionSnapshot, ReplayObservationStep, ReplaySemanticSnapshot } from "./scenario.js";
import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";
import {
  hasShape,
  isArrayOf,
  isBoolean,
  isEnumValue as isShapeEnumValue,
  isNullable,
  isNumber,
  isRecord,
  isString,
  isStringArray,
  validateWith,
} from "./shape.js";
import type { ReplaySessionBundle, ReplaySessionBundleSource } from "./session-bundle.js";

export const OFFLINE_REVIEW_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const OFFLINE_REVIEW_REPORT_SCHEMA_VERSION = 1 as const;
export const OFFLINE_REVIEW_RECOMMENDATION_SCHEMA_VERSION = 1 as const;
export const OFFLINE_REVIEW_RUN_SCHEMA_VERSION = 1 as const;
export const DEFAULT_OFFLINE_REVIEW_RUBRIC_VERSION = "offline-ai-review-v1" as const;
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

const OFFLINE_REVIEW_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const satisfies readonly OfflineReviewConfidence[];
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
const OFFLINE_REVIEW_RECOMMENDATION_TARGETS: Record<
  OfflineReviewFocusArea,
  readonly string[]
> = {
  title: [
    "packages/lab/src/public-trajectories.ts",
    "packages/lab/src/offline-review.ts",
  ],
  summary: [
    "packages/lab/src/public-trajectories.ts",
    "packages/lab/src/offline-review.ts",
  ],
  status: [
    "packages/lab/src/public-trajectories.ts",
    "packages/lab/src/offline-review.ts",
  ],
  ask: [
    "packages/core/src/semantic-ontology.ts",
    "packages/core/src/semantic-interpreter.ts",
  ],
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
  blocking: [
    "packages/core/src/semantic-interpreter.ts",
    "packages/core/src/semantic-ontology.ts",
  ],
  episode: [
    "packages/core/src/semantic-detection.ts",
    "packages/core/src/semantic-interpreter.ts",
    "packages/core/src/semantic-ontology.ts",
  ],
  confidence: [
    "packages/core/src/semantic-interpreter.ts",
    "packages/core/src/semantic-ontology.ts",
  ],
  source: [
    "packages/core/src/semantic-interpreter.ts",
    "packages/core/src/semantic-ontology.ts",
  ],
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
  const candidate = extractJsonCandidate(raw, {
    validators: [
      (value) => validateOfflineReviewArtifact(value) !== null,
      (value) => validateOfflineReviewResponsePayload(value) !== null,
    ],
    fallbackValidator: (value) => isRecord(value) && isRecord(value.review) && Array.isArray(value.review.findings),
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

function buildOfflineReviewPromptPacketWithBudget(
  artifact: OfflineReviewArtifact,
  limits: {
    maxSteps: number;
    excerptLimit: number;
    summaryLimit: number;
    titleLimit: number;
    whyNowLimit: number;
  },
): OfflineReviewPromptPacket {
  const selectedIndices = selectOfflineReviewPromptStepIndices(artifact.steps, limits.maxSteps);
  const steps = artifact.steps
    .filter((step) => selectedIndices.has(step.stepIndex))
    .map((step) => compactOfflineReviewPromptStep(step, limits));
  const description = artifact.bundle.description
    ? clipOfflineReviewPromptText(artifact.bundle.description, limits.summaryLimit)
    : null;
  const explanationHeadline = artifact.bundle.explanation?.headline
    ? clipOfflineReviewPromptText(artifact.bundle.explanation.headline, limits.whyNowLimit)
    : null;
  const explanationWhyNow = artifact.bundle.explanation?.whyNow
    ? clipOfflineReviewPromptText(artifact.bundle.explanation.whyNow, limits.whyNowLimit)
    : null;

  return {
    bundle: {
      sessionId: artifact.bundle.sessionId,
      title: clipOfflineReviewPromptText(artifact.bundle.title, limits.titleLimit) ?? artifact.bundle.title,
      ...(description ? { description } : {}),
      ...(artifact.bundle.source?.id ? { sourceId: artifact.bundle.source.id } : {}),
      ...(artifact.bundle.source?.label ? { sourceLabel: artifact.bundle.source.label } : {}),
      ...(explanationHeadline ? { explanationHeadline } : {}),
      ...(explanationWhyNow ? { explanationWhyNow } : {}),
      ...(artifact.bundle.explanation?.targetLane ? { targetLane: artifact.bundle.explanation.targetLane } : {}),
      ...(artifact.bundle.explanation?.routingAuthority !== undefined
        ? { routingAuthority: artifact.bundle.explanation.routingAuthority }
        : {}),
    },
    focusAreas: [...artifact.focusAreas],
    packet: {
      originalStepCount: artifact.steps.length,
      includedStepCount: steps.length,
      omittedStepCount: Math.max(artifact.steps.length - steps.length, 0),
      compaction: "deterministic",
    },
    steps,
  };
}

function compactOfflineReviewPromptStep(
  step: OfflineReviewPreparedStep,
  limits: {
    excerptLimit: number;
    summaryLimit: number;
    titleLimit: number;
    whyNowLimit: number;
  },
): OfflineReviewPromptStep {
  const stepLabel = step.stepLabel
    ? clipOfflineReviewPromptText(step.stepLabel, limits.titleLimit)
    : null;
  const sourceExcerpt = step.sourceExcerpt
    ? clipOfflineReviewPromptText(step.sourceExcerpt, limits.excerptLimit)
    : null;

  return {
    stepIndex: step.stepIndex,
    stepKind: step.stepKind,
    ...(stepLabel ? { stepLabel } : {}),
    ...(sourceExcerpt ? { sourceExcerpt } : {}),
    ...(step.sourceEvent ? { sourceEvent: compactOfflineReviewEventSummary(step.sourceEvent, limits) } : {}),
    ...(step.normalizedEvent ? { normalizedEvent: compactOfflineReviewEventSummary(step.normalizedEvent, limits) } : {}),
    ...(step.apertureRead ? { apertureRead: compactOfflineReviewRead(step.apertureRead, limits) } : {}),
    ...(step.apertureDecision ? { apertureDecision: compactOfflineReviewDecision(step.apertureDecision) } : {}),
  };
}

function compactOfflineReviewEventSummary(
  event: NonNullable<OfflineReviewPreparedStep["sourceEvent"]>,
  limits: {
    summaryLimit: number;
    titleLimit: number;
  },
): NonNullable<OfflineReviewPromptStep["sourceEvent"]> {
  return {
    type: event.type,
    title: clipOfflineReviewPromptText(event.title, limits.titleLimit),
    summary: clipOfflineReviewPromptText(event.summary, limits.summaryLimit),
    status: event.status,
    toolFamily: event.toolFamily,
  };
}

function compactOfflineReviewRead(
  read: NonNullable<OfflineReviewPreparedStep["apertureRead"]>,
  limits: {
    whyNowLimit: number;
  },
): NonNullable<OfflineReviewPromptStep["apertureRead"]> {
  return {
    ask: read.ask,
    intentFrame: read.intentFrame,
    toolFamily: read.toolFamily,
    consequence: read.consequence,
    blocking: read.blocking,
    episode: read.episode,
    confidence: read.confidence,
    source: read.source,
    abstained: read.abstained,
    whyNow: clipOfflineReviewPromptText(read.whyNow, limits.whyNowLimit),
    relationKinds: read.relationKinds.slice(0, 4),
  };
}

function compactOfflineReviewDecision(
  decision: NonNullable<OfflineReviewPreparedStep["apertureDecision"]>,
): NonNullable<OfflineReviewPromptStep["apertureDecision"]> {
  return {
    evaluationKind: decision.evaluationKind,
    decisionKind: decision.decisionKind,
    resultLane: decision.resultLane,
    semanticInfluence: decision.semanticInfluence.slice(0, 4),
  };
}

function selectOfflineReviewPromptStepIndices(
  steps: OfflineReviewPreparedStep[],
  maxSteps: number,
): Set<number> {
  if (steps.length <= maxSteps) {
    return new Set(steps.map((step) => step.stepIndex));
  }

  const firstStepIndex = steps[0]?.stepIndex ?? 0;
  const lastStepIndex = steps.at(-1)?.stepIndex ?? firstStepIndex;
  const selected = new Set<number>([firstStepIndex, lastStepIndex]);
  const ranked = steps
    .map((step) => ({
      stepIndex: step.stepIndex,
      priority: offlineReviewPromptStepPriority(step, lastStepIndex),
    }))
    .sort((left, right) => right.priority - left.priority || left.stepIndex - right.stepIndex);

  for (const entry of ranked) {
    if (selected.size >= maxSteps) {
      break;
    }
    selected.add(entry.stepIndex);
  }

  return new Set([...selected].sort((left, right) => left - right));
}

function offlineReviewPromptStepPriority(
  step: OfflineReviewPreparedStep,
  lastStepIndex: number,
): number {
  let priority = 0;

  if (step.stepIndex === 0 || step.stepIndex === lastStepIndex) {
    priority += 1_000;
  }

  if (step.sourceEvent?.type === "task.started" || step.sourceEvent?.type === "task.completed" || step.sourceEvent?.type === "task.cancelled") {
    priority += 900;
  }

  if (step.sourceEvent?.status === "failed" || step.normalizedEvent?.status === "failed") {
    priority += 850;
  } else if (step.sourceEvent?.status === "waiting" || step.normalizedEvent?.status === "waiting") {
    priority += 700;
  }

  if (step.apertureDecision?.resultLane === "now") {
    priority += 650;
  } else if (step.apertureDecision?.resultLane === "next") {
    priority += 600;
  }

  if (step.apertureRead?.abstained || step.apertureRead?.confidence === "low") {
    priority += 550;
  } else if (step.apertureRead?.confidence === "medium") {
    priority += 325;
  }

  if (step.apertureRead?.consequence === "high") {
    priority += 500;
  } else if (step.apertureRead?.consequence === "medium") {
    priority += 250;
  }

  if (step.sourceEvent?.toolFamily || step.normalizedEvent?.toolFamily || step.apertureRead?.toolFamily) {
    priority += 220;
  }

  if (step.sourceEvent?.title === "user follow-up" || step.stepLabel?.includes("followup") || step.stepLabel?.includes("follow-up")) {
    priority += 300;
  }

  if ((step.apertureDecision?.semanticInfluence.length ?? 0) > 0) {
    priority += 120;
  }

  return priority;
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

export function buildOfflineReviewPromptPacket(
  artifact: OfflineReviewArtifact,
  options: {
    maxChars?: number;
    maxSteps?: number;
  } = {},
): OfflineReviewPromptPacket {
  const maxChars = options.maxChars ?? DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_CHARS;
  const targetMaxSteps = Math.min(
    options.maxSteps ?? DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_STEPS,
    artifact.steps.length,
  );
  const minSteps = Math.min(DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_STEPS, artifact.steps.length);

  let maxSteps = Math.max(minSteps, targetMaxSteps);
  let excerptLimit = DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_EXCERPT_CHARS;
  let summaryLimit = DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_SUMMARY_CHARS;
  let titleLimit = DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_TITLE_CHARS;
  let whyNowLimit = DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_WHY_NOW_CHARS;

  let packet = buildOfflineReviewPromptPacketWithBudget(artifact, {
    maxSteps,
    excerptLimit,
    summaryLimit,
    titleLimit,
    whyNowLimit,
  });

  for (let attempts = 0; attempts < 64; attempts += 1) {
    if (renderOfflineReviewPromptFromPacket(packet).length <= maxChars) {
      return packet;
    }

    if (maxSteps > minSteps) {
      maxSteps -= 1;
    } else if (excerptLimit > DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_EXCERPT_CHARS) {
      excerptLimit = Math.max(DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_EXCERPT_CHARS, excerptLimit - 32);
      summaryLimit = Math.max(DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_SUMMARY_CHARS, summaryLimit - 24);
      titleLimit = Math.max(DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_TITLE_CHARS, titleLimit - 12);
      whyNowLimit = Math.max(DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_WHY_NOW_CHARS, whyNowLimit - 16);
    } else {
      return packet;
    }

    packet = buildOfflineReviewPromptPacketWithBudget(artifact, {
      maxSteps,
      excerptLimit,
      summaryLimit,
      titleLimit,
      whyNowLimit,
    });
  }

  return packet;
}

export function renderOfflineReviewPrompt(artifact: OfflineReviewArtifact): string {
  return renderOfflineReviewPromptFromPacket(buildOfflineReviewPromptPacket(artifact));
}

function renderOfflineReviewPromptFromPacket(packet: OfflineReviewPromptPacket): string {
  const lines = [
    "# Aperture Offline Review Prompt",
    "",
    "Review Aperture's current read for this bundle.",
    "Return JSON only with exactly one top-level `review` object.",
    "Do not include markdown fences, prose preambles, shell commands, or any non-JSON text.",
    "Add findings only for material mistakes or important omissions.",
    "Each finding must include: `stepIndex`, `focusArea`, `expected`, `confidence`.",
    "Optional fields: `supportingText`, `rationale`, `recommendation`.",
    "Recommendations: `promote` for crisp misses, `inspect` for plausible misses, `ignore` for weak disagreements.",
    "If there are no material mistakes, return `{\"review\":{\"findings\":[]}}`.",
    "",
    `Focus areas: ${packet.focusAreas.join(", ")}`,
    `Packet stats: original=${packet.packet.originalStepCount}, included=${packet.packet.includedStepCount}, omitted=${packet.packet.omittedStepCount}`,
    "",
    "```json",
    JSON.stringify(packet),
    "```",
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
  if (
    !isRecord(value)
    || value.schemaVersion !== OFFLINE_REVIEW_ARTIFACT_SCHEMA_VERSION
    || !hasShape(value, {
      generatedAt: isString,
      rubricVersion: isString,
      bundle: (bundle): bundle is OfflineReviewArtifact["bundle"] => (
        isRecord(bundle)
        && hasShape(bundle, { sessionId: isString, title: isString }, {
          description: isString,
          bundlePath: isString,
          source: validateWith(validateReviewBundleSource),
          explanation: validateWith(validateReviewBundleExplanation),
        })
      ),
      focusAreas: isArrayOf(isOfflineReviewFocusArea),
      instructions: isStringArray,
      steps: isArrayOf(validateWith(validatePreparedStep)),
      review: (review): review is OfflineReviewArtifact["review"] => (
        isRecord(review)
        && hasShape(review, { findings: isArrayOf(validateWith(validateOfflineReviewFinding)) }, {
          reviewer: isString,
          model: isString,
          completedAt: isString,
          notes: isString,
        })
      ),
    })
  ) {
    return null;
  }

  return value as OfflineReviewArtifact;
}

function validateReviewBundleExplanation(
  value: unknown,
): NonNullable<OfflineReviewArtifact["bundle"]["explanation"]> | null {
  if (
    !isRecord(value)
    || !hasShape(value, {}, {
      targetInteractionId: isString,
      targetLane: isString,
      headline: isString,
      whyNow: isNullable(isString),
      routingAuthority: isNullable(isString),
    })
  ) {
    return null;
  }

  if (
    value.targetLane !== undefined
    && !["now", "next", "ambient", "none"].includes(String(value.targetLane))
  ) {
    return null;
  }

  if (
    value.routingAuthority !== undefined
    && value.routingAuthority !== null
    && !["status", "request", "event"].includes(String(value.routingAuthority))
  ) {
    return null;
  }

  return value as NonNullable<OfflineReviewArtifact["bundle"]["explanation"]>;
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
            title: readEventStringField(normalized.event, "title"),
            summary: readEventStringField(normalized.event, "summary"),
            status: readEventStringField(normalized.event, "status"),
            toolFamily: readEventStringField(normalized.event, "toolFamily"),
          }
        : null,
      apertureRead: semantic ? buildSemanticSummary(step, semantic) : null,
      apertureDecision: decision
        ? {
            evaluationKind: decision.evaluationKind,
            decisionKind: decision.decisionKind ?? null,
            resultLane: decision.resultLane ?? null,
            semanticInfluence: [...(decision.semanticInfluence ?? [])],
          }
        : null,
    };
  });
}

function buildSourceExcerpt(step: ReplayObservationStep): string | null {
  switch (step.kind) {
    case "publishSource":
      return compactText([
        readEventStringField(step.event, "title"),
        readEventStringField(step.event, "summary"),
      ].filter(isNonEmptyString).join(" — "));
    case "publish":
      return compactText([
        readEventStringField(step.event, "title"),
        readEventStringField(step.event, "summary"),
      ].filter(isNonEmptyString).join(" — "));
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
    title: readEventStringField(event, "title"),
    summary: readEventStringField(event, "summary"),
    status: readEventStringField(event, "status"),
    toolFamily: readEventStringField(event, "toolFamily"),
  };
}

function buildSemanticSummary(
  step: ReplayObservationStep,
  snapshot: ReplaySemanticSnapshot,
): NonNullable<OfflineReviewPreparedStep["apertureRead"]> {
  const ontology = step.kind === "publishSource"
    ? (snapshot.ontology ?? readSemanticOntologyDiagnostic(step.event, snapshot.interpretation))
    : null;

  return {
    ask: ontology?.ask ?? null,
    intentFrame: snapshot.interpretation.intentFrame ?? null,
    toolFamily: snapshot.interpretation.toolFamily ?? null,
    consequence: snapshot.interpretation.consequence ?? null,
    blocking: ontology?.blocking ?? null,
    episode: ontology?.episode ?? null,
    confidence: snapshot.interpretation.confidence ?? null,
    source: ontology?.source ?? null,
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
      return inferOfflineReviewStatus(step);
    case "ask":
      return step.apertureRead?.ask ?? null;
    case "intentFrame":
      return step.apertureRead?.intentFrame ?? null;
    case "toolFamily":
      return step.apertureRead?.toolFamily ?? null;
    case "consequence":
      return step.apertureRead?.consequence ?? null;
    case "blocking":
      return step.apertureRead?.blocking ?? null;
    case "episode":
      return step.apertureRead?.episode ?? null;
    case "confidence":
      return step.apertureRead?.confidence ?? null;
    case "source":
      return step.apertureRead?.source ?? null;
  }
}

function inferOfflineReviewStatus(step: OfflineReviewPreparedStep): string | null {
  const status = step.normalizedEvent?.status ?? step.sourceEvent?.status ?? null;
  if (status !== "running") {
    return status;
  }

  if (step.stepLabel?.startsWith("assistant:message:") && looksLikeCompletedReviewAnswer(step)) {
    return "completed";
  }

  return status;
}

function looksLikeCompletedReviewAnswer(step: OfflineReviewPreparedStep): boolean {
  const text = [
    step.sourceEvent?.title,
    step.sourceEvent?.summary,
    step.normalizedEvent?.title,
    step.normalizedEvent?.summary,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLowerCase();

  if (text.length < 160 || text.includes("?")) {
    return false;
  }

  return text.startsWith("here is ")
    || text.startsWith("here's ")
    || text.startsWith("based on ")
    || text.includes("## ")
    || /\*\*\d+\./.test(text);
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
  return OFFLINE_REVIEW_DEFAULT_RECOMMENDATION[confidence];
}

function createFocusAreaCounts(): Record<OfflineReviewFocusArea, number> {
  return createCountRecord(ALL_OFFLINE_REVIEW_FOCUS_AREAS);
}

function validatePreparedStep(value: unknown): OfflineReviewPreparedStep | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      stepIndex: isNumber,
      stepKind: isString,
      sourceExcerpt: isNullable(isString),
      sourceEvent: validateWith(validatePreparedEventSummary),
      normalizedEvent: validateWith(validatePreparedEventSummary),
      apertureRead: validateWith(validatePreparedRead),
      apertureDecision: validateWith(validatePreparedDecision),
    }, {
      stepLabel: isString,
    })
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
    || !hasShape(value, {
      type: isString,
    }, {
      title: isNullable(isString),
      summary: isNullable(isString),
      status: isNullable(isString),
      toolFamily: isNullable(isString),
    })
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
    || !hasShape(value, {
      abstained: isBoolean,
      relationKinds: isStringArray,
    }, {
      ask: isNullable(isString),
      intentFrame: isNullable(isString),
      toolFamily: isNullable(isString),
      consequence: isNullable(isString),
      blocking: isNullable(isString),
      episode: isNullable(isString),
      confidence: isNullable(isString),
      source: isNullable(isString),
      whyNow: isNullable(isString),
    })
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
    || !hasShape(value, {
      evaluationKind: isString,
      semanticInfluence: isStringArray,
    }, {
      decisionKind: isNullable(isString),
      resultLane: isNullable(isString),
    })
  ) {
    return null;
  }

  return value as OfflineReviewPreparedStep["apertureDecision"];
}

function validateOfflineReviewFinding(value: unknown): OfflineReviewFinding | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      stepIndex: isNumber,
      focusArea: isOfflineReviewFocusArea,
      expected: isOfflineReviewFindingExpected,
      confidence: isOfflineReviewConfidence,
    }, {
      supportingText: isString,
      rationale: isString,
      recommendation: isOfflineReviewRecommendation,
    })
  ) {
    return null;
  }

  return value as OfflineReviewFinding;
}

function validateOfflineReviewResponsePayload(value: unknown): OfflineReviewResponsePayload | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      review: (review): review is OfflineReviewResponsePayload["review"] => (
        isRecord(review)
        && hasShape(review, { findings: isArrayOf(validateWith(validateOfflineReviewFinding)) }, {
          reviewer: isString,
          model: isString,
          completedAt: isString,
          notes: isString,
        })
      ),
    })
  ) {
    return null;
  }

  return value as OfflineReviewResponsePayload;
}

function validateReviewBundleSource(value: unknown): ReplaySessionBundleSource | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      id: isString,
    }, {
      kind: isString,
      label: isString,
      redacted: isBoolean,
      capture: validateReviewBundleCapture,
    })
  ) {
    return null;
  }

  return value as ReplaySessionBundleSource;
}

function validateReviewBundleCapture(value: unknown): value is NonNullable<ReplaySessionBundleSource["capture"]> {
  return isRecord(value)
    && hasShape(value, {}, {
      eventTransport: isString,
      semanticCapture: isString,
      responseBridge: isString,
      notes: isStringArray,
    });
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
  return OFFLINE_REVIEW_RECOMMENDATION_PRIORITY[left] - OFFLINE_REVIEW_RECOMMENDATION_PRIORITY[right];
}

function createRecommendationCounts(): Record<OfflineReviewRecommendation, number> {
  return createCountRecord(OFFLINE_REVIEW_RECOMMENDATIONS);
}

function createConfidenceCounts(): Record<OfflineReviewConfidence, number> {
  return createCountRecord(OFFLINE_REVIEW_CONFIDENCE_LEVELS);
}

function focusAreaOwner(
  focusArea: OfflineReviewFocusArea,
): OfflineReviewRecommendationOwner {
  return OFFLINE_REVIEW_FOCUS_AREA_OWNER[focusArea];
}

function recommendationTargets(focusArea: OfflineReviewFocusArea): string[] {
  return [...OFFLINE_REVIEW_RECOMMENDATION_TARGETS[focusArea]];
}

function recommendationSummary(focusArea: OfflineReviewFocusArea): string {
  return OFFLINE_REVIEW_RECOMMENDATION_SUMMARY[focusArea];
}

function isOfflineReviewFocusArea(value: unknown): value is OfflineReviewFocusArea {
  return isEnumValue(value, ALL_OFFLINE_REVIEW_FOCUS_AREAS);
}

function isOfflineReviewConfidence(value: unknown): value is OfflineReviewConfidence {
  return isEnumValue(value, OFFLINE_REVIEW_CONFIDENCE_LEVELS);
}

function isOfflineReviewRecommendation(value: unknown): value is OfflineReviewRecommendation {
  return isEnumValue(value, OFFLINE_REVIEW_RECOMMENDATIONS);
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

function clipOfflineReviewPromptText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = compactText(value ?? null);
  if (!normalized) {
    return null;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(maxLength - 3, 1))}...`;
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function createCountRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return isShapeEnumValue(allowed)(value);
}

function readEventStringField(
  value: { type: string } & Record<string, unknown>,
  field: "title" | "summary" | "status" | "toolFamily",
): string | null {
  return typeof value[field] === "string" ? value[field] : null;
}
