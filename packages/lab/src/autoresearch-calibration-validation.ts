import {
  hasShape,
  isArrayOf,
  isNumber,
  isRecord,
  isString,
} from "./shape.js";
import type {
  OfflineReviewDisagreement,
  OfflineReviewReport,
} from "./offline-review.js";
import type {
  AutoresearchCalibrationCase,
  AutoresearchCalibrationExpectation,
} from "./autoresearch-calibration.js";
import {
  createFocusAreaCountsFromRecord,
  isCalibrationSplit,
  isOfflineReviewConfidence,
  isOfflineReviewFocusArea,
  isOfflineReviewRecommendation,
  isOfflineReviewValue,
  isSemanticCalibrationFamily,
} from "./autoresearch-calibration-support.js";

export function validateAutoresearchCalibrationCase(
  value: unknown,
  options: { schemaVersion: AutoresearchCalibrationCase["schemaVersion"] },
): AutoresearchCalibrationCase | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== options.schemaVersion
  ) {
    return null;
  }

  const inputPath = typeof value.inputPath === "string"
    ? value.inputPath
    : typeof value.bundlePath === "string"
      ? value.bundlePath
      : null;
  if (
    inputPath === null
    || !hasShape(value, {
      promotedAt: isString,
      split: isCalibrationSplit,
      sessionId: isString,
      title: isString,
      targets: isArrayOf(isString),
      source: (source): source is NonNullable<AutoresearchCalibrationCase["source"]> => (
        isRecord(source) && hasShape(source, {
          reportPath: isString,
          disagreementCount: isNumber,
        })
      ),
      summary: (summary): summary is NonNullable<AutoresearchCalibrationCase["summary"]> => (
        isRecord(summary) && hasShape(summary, {
          correctedCount: isNumber,
          invariantCount: isNumber,
          focusAreaCounts: isRecord,
        })
      ),
      expectations: isArrayOf((entry): entry is AutoresearchCalibrationExpectation => (
        validateAutoresearchCalibrationExpectation(entry) !== null
      )),
    }, {
      bundlePath: isString,
      inputPath: isString,
    })
  ) {
    return null;
  }

  const promotedAt = value.promotedAt as string;
  const split = value.split as AutoresearchCalibrationCase["split"];
  const sessionId = value.sessionId as string;
  const title = value.title as string;
  const targets = value.targets as string[];
  const semanticFamilies = Array.isArray(value.semanticFamilies)
    ? value.semanticFamilies.filter(isSemanticCalibrationFamily)
    : [];
  const source = value.source as Record<string, unknown>;
  const summary = value.summary as Record<string, unknown>;
  const expectations = value.expectations as AutoresearchCalibrationExpectation[];
  const focusAreaCounts = summary.focusAreaCounts as Record<string, unknown>;
  return {
    schemaVersion: options.schemaVersion,
    promotedAt,
    split,
    sessionId,
    title,
    inputPath,
    ...(typeof value.bundlePath === "string" ? { bundlePath: value.bundlePath } : {}),
    targets: [...targets],
    semanticFamilies,
    source: {
      reportPath: source.reportPath as string,
      ...(typeof source.reviewer === "string" ? { reviewer: source.reviewer } : {}),
      ...(typeof source.model === "string" ? { model: source.model } : {}),
      disagreementCount: source.disagreementCount as number,
    },
    summary: {
      correctedCount: summary.correctedCount as number,
      invariantCount: summary.invariantCount as number,
      focusAreaCounts: createFocusAreaCountsFromRecord(focusAreaCounts),
    },
    expectations,
  };
}

export function validateOfflineReviewReport(value: unknown): OfflineReviewReport | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      generatedAt: isString,
      rubricVersion: isString,
      bundle: (bundle): bundle is NonNullable<OfflineReviewReport["bundle"]> => (
        isRecord(bundle) && hasShape(bundle, {
          sessionId: isString,
          title: isString,
        })
      ),
      review: isRecord,
      summary: (summary): summary is NonNullable<OfflineReviewReport["summary"]> => (
        isRecord(summary) && hasShape(summary, {
          totalFindings: isNumber,
          disagreementCount: isNumber,
          matchedFindings: isNumber,
          disagreementsByFocusArea: isRecord,
        })
      ),
      disagreements: isArrayOf((entry): entry is OfflineReviewDisagreement => validateOfflineReviewDisagreement(entry) !== null),
    })
  ) {
    return null;
  }

  const bundle = value.bundle as Record<string, unknown>;
  const review = value.review as Record<string, unknown>;
  const summary = value.summary as Record<string, unknown>;
  const disagreements = value.disagreements as OfflineReviewDisagreement[];

  return {
    schemaVersion: value.schemaVersion as OfflineReviewReport["schemaVersion"],
    generatedAt: value.generatedAt as string,
    rubricVersion: value.rubricVersion as string,
    bundle: {
      sessionId: bundle.sessionId as string,
      title: bundle.title as string,
      ...(typeof bundle.description === "string" ? { description: bundle.description } : {}),
      ...(typeof bundle.bundlePath === "string" ? { bundlePath: bundle.bundlePath } : {}),
      ...(isRecord(bundle.source)
        ? { source: bundle.source as NonNullable<OfflineReviewReport["bundle"]["source"]> }
        : {}),
    },
    review: {
      ...(typeof review.reviewer === "string" ? { reviewer: review.reviewer } : {}),
      ...(typeof review.model === "string" ? { model: review.model } : {}),
      ...(typeof review.completedAt === "string" ? { completedAt: review.completedAt } : {}),
      ...(typeof review.notes === "string" ? { notes: review.notes } : {}),
    },
    summary: {
      totalFindings: summary.totalFindings as number,
      disagreementCount: summary.disagreementCount as number,
      matchedFindings: summary.matchedFindings as number,
      disagreementsByFocusArea: createFocusAreaCountsFromRecord(summary.disagreementsByFocusArea as Record<string, unknown>),
    },
    disagreements,
  };
}

function validateAutoresearchCalibrationExpectation(
  value: unknown,
): AutoresearchCalibrationExpectation | null {
  if (
    !isRecord(value)
    || typeof value.stepIndex !== "number"
    || !isOfflineReviewFocusArea(value.focusArea)
    || (value.mode !== "corrected" && value.mode !== "invariant")
    || !isOfflineReviewValue(value.expectedValue)
    || !isOfflineReviewValue(value.observedValueAtPromotion)
    || !isOfflineReviewConfidence(value.confidence)
  ) {
    return null;
  }

  return {
    stepIndex: value.stepIndex,
    ...(typeof value.stepLabel === "string" ? { stepLabel: value.stepLabel } : {}),
    focusArea: value.focusArea,
    mode: value.mode,
    expectedValue: value.expectedValue,
    observedValueAtPromotion: value.observedValueAtPromotion,
    confidence: value.confidence,
    ...(typeof value.rationale === "string" ? { rationale: value.rationale } : {}),
    ...(typeof value.supportingText === "string" ? { supportingText: value.supportingText } : {}),
  };
}

function validateOfflineReviewDisagreement(value: unknown): OfflineReviewDisagreement | null {
  if (
    !isRecord(value)
    || typeof value.stepIndex !== "number"
    || !isOfflineReviewFocusArea(value.focusArea)
    || !isOfflineReviewValue(value.apertureValue)
    || !isOfflineReviewValue(value.expectedValue)
    || !isOfflineReviewConfidence(value.confidence)
    || !isOfflineReviewRecommendation(value.recommendation)
  ) {
    return null;
  }

  return {
    stepIndex: value.stepIndex,
    ...(typeof value.stepLabel === "string" ? { stepLabel: value.stepLabel } : {}),
    focusArea: value.focusArea,
    apertureValue: value.apertureValue,
    expectedValue: value.expectedValue,
    confidence: value.confidence,
    ...(typeof value.supportingText === "string" ? { supportingText: value.supportingText } : {}),
    ...(typeof value.rationale === "string" ? { rationale: value.rationale } : {}),
    recommendation: value.recommendation,
  };
}
