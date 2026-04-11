import { readSemanticOntologyDiagnostic } from "@tomismeta/aperture-core/semantic";

import type { ReplayObservationStep, ReplaySemanticSnapshot } from "./scenario.js";
import type { ReplaySessionBundle } from "./session-bundle.js";
import type {
  OfflineReviewConfidence,
  OfflineReviewDisagreement,
  OfflineReviewFocusArea,
  OfflineReviewPreparedStep,
  OfflineReviewRecommendation,
  OfflineReviewRecommendationItem,
  OfflineReviewRecommendationOwner,
} from "./offline-review.js";

export function buildPreparedSteps(bundle: ReplaySessionBundle): OfflineReviewPreparedStep[] {
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
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.every((value, index) => value === sortedRight[index]);
  }

  return normalizeOfflineReviewScalar(left) === normalizeOfflineReviewScalar(right);
}

export function defaultRecommendation(
  confidence: OfflineReviewConfidence,
  defaults: Record<OfflineReviewConfidence, OfflineReviewRecommendation>,
): OfflineReviewRecommendation {
  return defaults[confidence];
}

export function createFocusAreaCounts(
  focusAreas: readonly OfflineReviewFocusArea[],
): Record<OfflineReviewFocusArea, number> {
  return createCountRecord(focusAreas);
}

export function createRecommendationCounts(
  recommendations: readonly OfflineReviewRecommendation[],
): Record<OfflineReviewRecommendation, number> {
  return createCountRecord(recommendations);
}

export function buildRecommendationItem(
  focusArea: OfflineReviewFocusArea,
  disagreements: OfflineReviewDisagreement[],
  options: {
    confidenceLevels: readonly OfflineReviewConfidence[];
    ownerByFocusArea: Record<OfflineReviewFocusArea, OfflineReviewRecommendationOwner>;
    targetsByFocusArea: Record<OfflineReviewFocusArea, readonly string[]>;
    summaryByFocusArea: Record<OfflineReviewFocusArea, string>;
    priorityByRecommendation: Record<OfflineReviewRecommendation, number>;
  },
): OfflineReviewRecommendationItem {
  const confidenceCounts = createCountRecord(options.confidenceLevels);
  let recommendation: OfflineReviewRecommendation = "ignore";
  for (const disagreement of disagreements) {
    confidenceCounts[disagreement.confidence] += 1;
    if (compareRecommendationPriority(
      disagreement.recommendation,
      recommendation,
      options.priorityByRecommendation,
    ) < 0) {
      recommendation = disagreement.recommendation;
    }
  }

  return {
    focusArea,
    owner: options.ownerByFocusArea[focusArea],
    targets: [...options.targetsByFocusArea[focusArea]],
    recommendation,
    disagreementCount: disagreements.length,
    confidenceCounts,
    summary: options.summaryByFocusArea[focusArea],
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

export function compareRecommendationItems(
  left: OfflineReviewRecommendationItem,
  right: OfflineReviewRecommendationItem,
  priorityByRecommendation: Record<OfflineReviewRecommendation, number>,
): number {
  const priority = compareRecommendationPriority(
    left.recommendation,
    right.recommendation,
    priorityByRecommendation,
  );
  if (priority !== 0) {
    return priority;
  }
  return right.disagreementCount - left.disagreementCount;
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

function compareRecommendationPriority(
  left: OfflineReviewRecommendation,
  right: OfflineReviewRecommendation,
  priorityByRecommendation: Record<OfflineReviewRecommendation, number>,
): number {
  return priorityByRecommendation[left] - priorityByRecommendation[right];
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

function createCountRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function readEventStringField(
  value: { type: string } & Record<string, unknown>,
  field: "title" | "summary" | "status" | "toolFamily",
): string | null {
  return typeof value[field] === "string" ? value[field] : null;
}
