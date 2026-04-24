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
import type { ReplaySessionBundleSource } from "./session-bundle.js";
import type {
  OfflineReviewArtifact,
  OfflineReviewConfidence,
  OfflineReviewFinding,
  OfflineReviewFocusArea,
  OfflineReviewPreparedStep,
  OfflineReviewRecommendation,
  OfflineReviewResponsePayload,
} from "./offline-review.js";
import { validateWorkflowTargetMetadata } from "./workflow-metadata.js";

export function validateOfflineReviewArtifact(
  value: unknown,
  options: {
    artifactSchemaVersion: number;
    allFocusAreas: readonly OfflineReviewFocusArea[];
    confidenceLevels: readonly OfflineReviewConfidence[];
    recommendations: readonly OfflineReviewRecommendation[];
  },
): OfflineReviewArtifact | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== options.artifactSchemaVersion
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
      focusAreas: isArrayOf((entry): entry is OfflineReviewFocusArea => isOfflineReviewFocusArea(entry, options.allFocusAreas)),
      instructions: isStringArray,
      steps: isArrayOf((entry): entry is OfflineReviewPreparedStep => validatePreparedStep(entry) !== null),
      review: (review): review is OfflineReviewArtifact["review"] => (
        isRecord(review)
        && hasShape(review, { findings: isArrayOf((entry): entry is OfflineReviewFinding => validateOfflineReviewFinding(
          entry,
          options,
        ) !== null) }, {
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

export function validateOfflineReviewResponsePayload(
  value: unknown,
  options: {
    allFocusAreas: readonly OfflineReviewFocusArea[];
    confidenceLevels: readonly OfflineReviewConfidence[];
    recommendations: readonly OfflineReviewRecommendation[];
  },
): OfflineReviewResponsePayload | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      review: (review): review is OfflineReviewResponsePayload["review"] => (
        isRecord(review)
        && hasShape(review, { findings: isArrayOf((entry): entry is OfflineReviewFinding => validateOfflineReviewFinding(
          entry,
          options,
        ) !== null) }, {
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

function validateReviewBundleExplanation(
  value: unknown,
): NonNullable<OfflineReviewArtifact["bundle"]["explanation"]> | null {
  if (
    !isRecord(value)
    || !hasShape(value, {}, {
      targetInteractionId: isString,
      targetLane: isString,
      headline: isString,
      targetMetadata: validateWith(validateWorkflowTargetMetadata),
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

function validateOfflineReviewFinding(
  value: unknown,
  options: {
    allFocusAreas: readonly OfflineReviewFocusArea[];
    confidenceLevels: readonly OfflineReviewConfidence[];
    recommendations: readonly OfflineReviewRecommendation[];
  },
): OfflineReviewFinding | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      stepIndex: isNumber,
      focusArea: (entry): entry is OfflineReviewFocusArea => isOfflineReviewFocusArea(entry, options.allFocusAreas),
      expected: isOfflineReviewFindingExpected,
      confidence: (entry): entry is OfflineReviewConfidence => isOfflineReviewConfidence(entry, options.confidenceLevels),
    }, {
      supportingText: isString,
      rationale: isString,
      recommendation: (entry): entry is OfflineReviewRecommendation => isOfflineReviewRecommendation(
        entry,
        options.recommendations,
      ),
    })
  ) {
    return null;
  }

  return value as OfflineReviewFinding;
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

function isOfflineReviewFocusArea(
  value: unknown,
  focusAreas: readonly OfflineReviewFocusArea[],
): value is OfflineReviewFocusArea {
  return isEnumValue(value, focusAreas);
}

function isOfflineReviewConfidence(
  value: unknown,
  confidenceLevels: readonly OfflineReviewConfidence[],
): value is OfflineReviewConfidence {
  return isEnumValue(value, confidenceLevels);
}

function isOfflineReviewRecommendation(
  value: unknown,
  recommendations: readonly OfflineReviewRecommendation[],
): value is OfflineReviewRecommendation {
  return isEnumValue(value, recommendations);
}

function isOfflineReviewFindingExpected(
  value: unknown,
): value is OfflineReviewFinding["expected"] {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || isStringArray(value);
}

function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return isShapeEnumValue(allowed)(value);
}
