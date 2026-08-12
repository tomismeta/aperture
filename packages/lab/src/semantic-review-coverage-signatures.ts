import type { TaskFailureSemanticEvidence } from "@tomismeta/aperture-core/internal";

import { compareKernelCanonicalKey } from "./kernel-canonical-json.js";
import type { OfflineReviewPreparedStep } from "./offline-review.js";
import type {
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplaySemanticSnapshot,
} from "./scenario.js";
import type { ReplaySessionBundle } from "./session-bundle.js";
import { readFailureEvidenceEventShape } from "./semantic-review-failure-event-shapes.js";
import type {
  SemanticReviewLedgerSignatureCount,
  SemanticReviewLedgerSignatureExample,
  SemanticReviewNoveltySummary,
  SemanticReviewSignatureBaselineComparison,
} from "./semantic-review-coverage-ledger-types.js";

export type CoverageSignatureCount = {
  count: number;
  firstExample: SemanticReviewLedgerSignatureExample;
};

export type CoverageLedgerStepInput = {
  bundle: ReplaySessionBundle;
  bundlePath: string;
  step: OfflineReviewPreparedStep;
  normalized: ReplayNormalizedEventSnapshot | null;
  semantic: ReplaySemanticSnapshot | null;
  decision: ReplayDecisionSnapshot | null;
  failureEvidence: TaskFailureSemanticEvidence | null;
};

export function structuralCoverageSignature(input: CoverageLedgerStepInput): string {
  const event = input.normalized?.event ?? input.step.sourceEvent ?? null;
  const semantic = input.semantic?.interpretation ?? null;
  const decision = input.decision;
  return [
    `step:${valueOrNone(input.step.stepKind)}`,
    `event:${valueOrNone(eventField(event, "type"))}`,
    `status:${valueOrNone(eventField(event, "status"))}`,
    `event_tool:${valueOrNone(eventField(event, "toolFamily"))}`,
    `intent:${valueOrNone(semantic?.intentFrame)}`,
    `activity:${valueOrNone(semantic?.activityClass)}`,
    `semantic_tool:${valueOrNone(semantic?.toolFamily)}`,
    `consequence:${valueOrNone(semantic?.consequence)}`,
    `confidence:${valueOrNone(semantic?.confidence)}`,
    `decision:${valueOrNone(decision?.decisionKind)}`,
    `planned:${valueOrNone(decision?.plannedLane)}`,
    `result:${valueOrNone(decision?.resultLane)}`,
    `ambiguity:${valueOrNone(decision?.ambiguity?.reason)}`,
  ].join("|");
}

export function failureCoverageSignature(input: CoverageLedgerStepInput): string {
  const event = input.normalized?.event ?? input.step.sourceEvent ?? null;
  const evidence = input.failureEvidence;
  if (!evidence) return "failure:none";
  return [
    `step:${valueOrNone(input.step.stepKind)}`,
    `failure:${evidence.kind}`,
    `detail:${valueOrNone(evidence.failureDetail)}`,
    `tool:${valueOrNone(evidence.toolFamily ?? eventField(event, "toolFamily"))}`,
    `baseline:${evidence.consequenceBaseline}`,
    `shape:${readFailureEvidenceEventShape({
      evidence,
      event: {
        summary: eventField(event, "summary"),
        toolFamily: eventField(event, "toolFamily"),
      },
    })}`,
    `decision:${valueOrNone(input.decision?.decisionKind)}`,
    `result:${valueOrNone(input.decision?.resultLane)}`,
  ].join("|");
}

export function summarizeCoverageNovelty(
  signatures: Map<string, CoverageSignatureCount>,
  limits: { maxSignatureEntries: number },
): SemanticReviewNoveltySummary {
  const topSignatures = [...signatures.entries()]
    .map(([signature, entry]) => ({
      signature,
      count: entry.count,
      firstExample: entry.firstExample,
    }))
    .sort(compareSignatureCounts)
    .slice(0, limits.maxSignatureEntries);
  const counts = [...signatures.values()].map((entry) => entry.count);
  const observedCount = counts.reduce((sum, count) => sum + count, 0);
  return {
    observedCount,
    uniqueSignatureCount: signatures.size,
    duplicateObservationCount: observedCount - signatures.size,
    repeatedSignatureCount: counts.filter((count) => count > 1).length,
    maxSignatureCount: counts.length === 0 ? 0 : Math.max(...counts),
    topSignatures,
  };
}

export function compareCoverageSignatureBaseline(
  observed: Map<string, CoverageSignatureCount>,
  baseline: Map<string, CoverageSignatureCount>,
  limits: { maxSignatureEntries: number },
): SemanticReviewSignatureBaselineComparison {
  let coveredSignatureCount = 0;
  let coveredObservationCount = 0;
  const novelSignatures = new Map<string, CoverageSignatureCount>();

  for (const [signature, entry] of observed.entries()) {
    if (baseline.has(signature)) {
      coveredSignatureCount += 1;
      coveredObservationCount += entry.count;
    } else {
      novelSignatures.set(signature, entry);
    }
  }

  const novelSummary = summarizeCoverageNovelty(novelSignatures, limits);
  return {
    baselineObservedCount: sumSignatureCounts(baseline),
    baselineUniqueSignatureCount: baseline.size,
    observedUniqueSignatureCount: observed.size,
    coveredSignatureCount,
    coveredObservationCount,
    novelSignatureCount: novelSummary.uniqueSignatureCount,
    novelObservationCount: novelSummary.observedCount,
    repeatedNovelSignatureCount: novelSummary.repeatedSignatureCount,
    topNovelSignatures: novelSummary.topSignatures,
  };
}

export function createCoverageSignatureExample(
  input: CoverageLedgerStepInput,
): SemanticReviewLedgerSignatureExample {
  return {
    bundlePath: input.bundlePath,
    sessionId: input.bundle.sessionId,
    title: input.bundle.title,
    stepIndex: input.step.stepIndex,
    ...(input.step.stepLabel ? { stepLabel: input.step.stepLabel } : {}),
  };
}

export function addCoverageSignature(
  signatures: Map<string, CoverageSignatureCount>,
  signature: string,
  firstExample: SemanticReviewLedgerSignatureExample,
): void {
  const current = signatures.get(signature);
  signatures.set(signature, {
    count: (current?.count ?? 0) + 1,
    firstExample:
      current && compareSignatureExamples(current.firstExample, firstExample) <= 0
        ? current.firstExample
        : firstExample,
  });
}

function compareSignatureCounts(
  left: SemanticReviewLedgerSignatureCount,
  right: SemanticReviewLedgerSignatureCount,
): number {
  return right.count - left.count || compareKernelCanonicalKey(left.signature, right.signature);
}

function sumSignatureCounts(signatures: Map<string, CoverageSignatureCount>): number {
  return [...signatures.values()].reduce((sum, entry) => sum + entry.count, 0);
}

function compareSignatureExamples(
  left: SemanticReviewLedgerSignatureExample,
  right: SemanticReviewLedgerSignatureExample,
): number {
  return (
    compareKernelCanonicalKey(left.bundlePath, right.bundlePath) ||
    left.stepIndex - right.stepIndex ||
    compareKernelCanonicalKey(left.sessionId, right.sessionId)
  );
}

function valueOrNone(value: string | undefined | null): string {
  return value ?? "none";
}

function eventField(
  event: unknown,
  key: "type" | "status" | "summary" | "toolFamily",
): string | null {
  if (event === null || typeof event !== "object") {
    return null;
  }
  const value = (event as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}
