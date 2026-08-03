import { compareKernelCanonicalKey, digestKernelCanonicalJson } from "./kernel-canonical-json.js";
import { KERNEL_CORPUS_PROFILE } from "./kernel-corpus-profile.js";
import {
  addCoverageSignature,
  createCoverageSignatureExample,
  failureCoverageSignature,
  structuralCoverageSignature,
  compareCoverageSignatureBaseline,
  summarizeCoverageNovelty,
  type CoverageLedgerStepInput,
  type CoverageSignatureCount,
} from "./semantic-review-coverage-signatures.js";
import {
  SEMANTIC_REVIEW_COVERAGE_SIGNATURE_SCHEMA_VERSION,
  type SemanticReviewCoverageBaseline,
  type SemanticReviewCoverageBaselineComparison,
  type SemanticReviewCoverageBaselineComparisonStatus,
  type SemanticReviewCoverageEvaluationMode,
  type SemanticReviewCoverageReport,
} from "./semantic-review-coverage-ledger-types.js";

const SEMANTIC_COUNT_KEYS = [
  "intentFrame",
  "activityClass",
  "toolFamily",
  "consequence",
  "confidence",
] as const;
const JUDGMENT_COUNT_KEYS = [
  "evaluationKind",
  "decisionKind",
  "plannedLane",
  "resultLane",
  "ambiguityReason",
  "reasonCodeFamily",
] as const;

type SemanticCountKey = (typeof SEMANTIC_COUNT_KEYS)[number];
type JudgmentCountKey = (typeof JUDGMENT_COUNT_KEYS)[number];

export type SemanticReviewCoverageLedgerAccumulator = {
  observedStepCount: number;
  missingSemanticCount: number;
  missingDecisionCount: number;
  semanticAbstainedCount: number;
  structuralSignatures: Map<string, CoverageSignatureCount>;
  failureSignatures: Map<string, CoverageSignatureCount>;
  semantic: Record<SemanticCountKey, Map<string, number>>;
  judgment: Record<JudgmentCountKey, Map<string, number>>;
};

export type SemanticReviewCoverageBaselineComparisonInput =
  | {
      status: "compared";
      baseline: SemanticReviewCoverageLedgerAccumulator;
    }
  | {
      status: Exclude<SemanticReviewCoverageBaselineComparisonStatus, "compared">;
      reason: string;
    };

export function createCoverageLedgerAccumulator(): SemanticReviewCoverageLedgerAccumulator {
  return {
    observedStepCount: 0,
    missingSemanticCount: 0,
    missingDecisionCount: 0,
    semanticAbstainedCount: 0,
    structuralSignatures: new Map(),
    failureSignatures: new Map(),
    semantic: createCountMaps(...SEMANTIC_COUNT_KEYS),
    judgment: createCountMaps(...JUDGMENT_COUNT_KEYS),
  };
}

export function addCoverageLedgerStep(
  accumulator: SemanticReviewCoverageLedgerAccumulator,
  input: CoverageLedgerStepInput,
): void {
  const semantic = input.semantic?.interpretation ?? null;
  const decision = input.decision;
  accumulator.observedStepCount += 1;
  if (!semantic) accumulator.missingSemanticCount += 1;
  if (!decision) accumulator.missingDecisionCount += 1;
  if (semantic?.abstained === true || decision?.semanticAbstained === true) {
    accumulator.semanticAbstainedCount += 1;
  }

  increment(accumulator.semantic.intentFrame, semantic?.intentFrame);
  increment(accumulator.semantic.activityClass, semantic?.activityClass);
  increment(accumulator.semantic.toolFamily, semantic?.toolFamily);
  increment(accumulator.semantic.consequence, semantic?.consequence);
  increment(accumulator.semantic.confidence, semantic?.confidence);
  increment(accumulator.judgment.evaluationKind, decision?.evaluationKind);
  increment(accumulator.judgment.decisionKind, decision?.decisionKind);
  increment(accumulator.judgment.plannedLane, decision?.plannedLane);
  increment(accumulator.judgment.resultLane, decision?.resultLane);
  increment(accumulator.judgment.ambiguityReason, decision?.ambiguity?.reason);
  for (const reasonCode of decision?.decisionRecordReasonCodes ?? []) {
    increment(accumulator.judgment.reasonCodeFamily, reasonCodeFamily(reasonCode));
  }

  const example = createCoverageSignatureExample(input);
  addCoverageSignature(
    accumulator.structuralSignatures,
    structuralCoverageSignature(input),
    example,
  );
  if (input.failureEvidence) {
    addCoverageSignature(accumulator.failureSignatures, failureCoverageSignature(input), example);
  }
}

export function finalizeCoverageLedgerSummary(
  accumulator: SemanticReviewCoverageLedgerAccumulator,
  options: {
    maxSignatureEntries: number;
    engineFingerprint: string;
    evaluationMode: SemanticReviewCoverageEvaluationMode;
    baselineComparison: SemanticReviewCoverageBaselineComparisonInput;
  },
): SemanticReviewCoverageReport {
  const structuralSignature = summarizeCoverageNovelty(accumulator.structuralSignatures, options);
  const failureSignature = summarizeCoverageNovelty(accumulator.failureSignatures, options);
  return {
    shapeSchemaVersion: 1,
    baseline: createCoverageBaseline(options),
    observations: {
      stepCount: accumulator.observedStepCount,
      semanticComparableCount: accumulator.observedStepCount - accumulator.missingSemanticCount,
      judgmentComparableCount: accumulator.observedStepCount - accumulator.missingDecisionCount,
      missingSemanticCount: accumulator.missingSemanticCount,
      missingJudgmentCount: accumulator.missingDecisionCount,
      semanticAbstainedCount: accumulator.semanticAbstainedCount,
    },
    corpusNovelty: { structuralSignature, failureSignature },
    corpusComparison: createBaselineComparison(accumulator, options),
    semantic: {
      intentFrameCounts: toCountRecord(accumulator.semantic.intentFrame),
      activityClassCounts: toCountRecord(accumulator.semantic.activityClass),
      toolFamilyCounts: toCountRecord(accumulator.semantic.toolFamily),
      consequenceCounts: toCountRecord(accumulator.semantic.consequence),
      confidenceCounts: toCountRecord(accumulator.semantic.confidence),
    },
    judgment: {
      evaluationKindCounts: toCountRecord(accumulator.judgment.evaluationKind),
      decisionKindCounts: toCountRecord(accumulator.judgment.decisionKind),
      plannedLaneCounts: toCountRecord(accumulator.judgment.plannedLane),
      resultLaneCounts: toCountRecord(accumulator.judgment.resultLane),
      ambiguityReasonCounts: toCountRecord(accumulator.judgment.ambiguityReason),
      reasonCodeFamilyCounts: toCountRecord(accumulator.judgment.reasonCodeFamily),
    },
  };
}

export function unavailableCoverageBaselineComparison(
  status: Exclude<SemanticReviewCoverageBaselineComparisonStatus, "compared">,
  reason: string,
): SemanticReviewCoverageBaselineComparisonInput {
  return { status, reason };
}

function createCoverageBaseline(options: {
  engineFingerprint: string;
  evaluationMode: SemanticReviewCoverageEvaluationMode;
  baselineComparison: SemanticReviewCoverageBaselineComparisonInput;
}): SemanticReviewCoverageBaseline {
  return {
    profileId: KERNEL_CORPUS_PROFILE.id,
    profileVersion: KERNEL_CORPUS_PROFILE.version,
    profileDigest: digestKernelCanonicalJson(KERNEL_CORPUS_PROFILE),
    signatureSchemaVersion: SEMANTIC_REVIEW_COVERAGE_SIGNATURE_SCHEMA_VERSION,
    signatureSetDigest:
      options.baselineComparison.status === "compared"
        ? signatureSetDigest(options.baselineComparison.baseline)
        : null,
    engineFingerprint: options.engineFingerprint,
    evaluationMode: options.evaluationMode,
    authority: "engine_observation_coverage",
  };
}

function createBaselineComparison(
  accumulator: SemanticReviewCoverageLedgerAccumulator,
  options: {
    maxSignatureEntries: number;
    baselineComparison: SemanticReviewCoverageBaselineComparisonInput;
  },
): SemanticReviewCoverageBaselineComparison {
  if (options.baselineComparison.status !== "compared") {
    return {
      status: options.baselineComparison.status,
      reason: options.baselineComparison.reason,
      structuralSignature: null,
      failureSignature: null,
    };
  }

  return {
    status: "compared",
    reason: null,
    structuralSignature: compareCoverageSignatureBaseline(
      accumulator.structuralSignatures,
      options.baselineComparison.baseline.structuralSignatures,
      options,
    ),
    failureSignature: compareCoverageSignatureBaseline(
      accumulator.failureSignatures,
      options.baselineComparison.baseline.failureSignatures,
      options,
    ),
  };
}

function createCountMaps<Key extends string>(...keys: Key[]): Record<Key, Map<string, number>> {
  return Object.fromEntries(keys.map((key) => [key, new Map<string, number>()])) as Record<
    Key,
    Map<string, number>
  >;
}

function increment(counts: Map<string, number>, value: string | undefined | null): void {
  const key = valueOrNone(value);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function toCountRecord(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => compareKernelCanonicalKey(left, right)),
  );
}

function reasonCodeFamily(reasonCode: string): string {
  return reasonCode.split(":", 1)[0] || "none";
}

function valueOrNone(value: string | undefined | null): string {
  return value ?? "none";
}

function signatureSetDigest(
  accumulator: SemanticReviewCoverageLedgerAccumulator,
): `sha256:${string}` {
  return digestKernelCanonicalJson({
    signatureSchemaVersion: SEMANTIC_REVIEW_COVERAGE_SIGNATURE_SCHEMA_VERSION,
    structural: sortedSignatureKeys(accumulator.structuralSignatures),
    failure: sortedSignatureKeys(accumulator.failureSignatures),
  });
}

function sortedSignatureKeys(signatures: Map<string, CoverageSignatureCount>): string[] {
  return [...signatures.keys()].sort(compareKernelCanonicalKey);
}
