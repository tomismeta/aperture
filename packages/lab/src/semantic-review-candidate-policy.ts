import path from "node:path";

import type { OfflineReviewFocusArea, OfflineReviewPreparedStep } from "./offline-review.js";
import type {
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplaySemanticSnapshot,
} from "./scenario.js";
import {
  SEMANTIC_REVIEW_CANDIDATE_KINDS,
  type CandidateBundleInput,
  type SemanticReviewCandidate,
  type SemanticReviewCandidateKind,
} from "./semantic-review-candidate-types.js";
import type { ReplaySessionBundle } from "./session-bundle.js";

const KNOWN_TOOL_FAMILIES = new Set(["bash", "edit", "read", "search", "task", "web", "write"]);

export function candidateKindsForStep(
  step: OfflineReviewPreparedStep,
  semantic: ReplaySemanticSnapshot | null,
  decision: ReplayDecisionSnapshot | null,
): SemanticReviewCandidateKind[] {
  const kinds: SemanticReviewCandidateKind[] = [];
  const interpretation = semantic?.interpretation;
  const sourceStatus = step.normalizedEvent?.status ?? step.sourceEvent?.status ?? null;
  const confidence = interpretation?.confidence ?? decision?.semanticConfidence ?? null;
  const toolFamily = interpretation?.toolFamily ?? step.normalizedEvent?.toolFamily ?? null;
  const isHighConsequenceAttention =
    interpretation?.consequence === "high" || decision?.resultLane === "now";
  const isFailureAttention = sourceStatus === "failed" || interpretation?.intentFrame === "failure";
  const isBlockedAttention =
    sourceStatus === "blocked" ||
    interpretation?.intentFrame === "blocked_work" ||
    step.apertureRead?.blocking === "blocking";
  const isQueueDecision =
    decision?.decisionKind === "queue" ||
    decision?.plannedLane === "next" ||
    decision?.resultLane === "next";
  const isAttentionRoutingDecision =
    isQueueDecision || decision?.plannedLane === "now" || decision?.resultLane === "now";
  const isSemanticUncertainty =
    confidence === "low" ||
    confidence === "medium" ||
    interpretation?.abstained === true ||
    (decision?.ambiguity !== undefined && decision.ambiguity !== null);
  const hasRelationSignal = (interpretation?.relationHints.length ?? 0) > 0;

  if (
    semantic &&
    !hasNonEmptyWhyNow(interpretation?.whyNow) &&
    (isHighConsequenceAttention ||
      isFailureAttention ||
      isBlockedAttention ||
      isAttentionRoutingDecision ||
      isSemanticUncertainty ||
      hasRelationSignal)
  ) {
    kinds.push("missing_why_now");
  }
  if (isHighConsequenceAttention) {
    kinds.push("high_consequence_attention");
  }
  if (isFailureAttention) {
    kinds.push("failure_attention");
  }
  if (isBlockedAttention) {
    kinds.push("blocked_attention");
  }
  if (isQueueDecision) {
    kinds.push("queue_decision");
  }
  if (isSemanticUncertainty) {
    kinds.push("semantic_uncertainty");
  }
  if (hasToolTaxonomyGap(toolFamily)) {
    kinds.push("tool_taxonomy_gap");
  }
  if (hasRelationSignal) {
    kinds.push("relation_signal");
  }

  return kinds;
}

export function buildSemanticReviewCandidate(
  kind: SemanticReviewCandidateKind,
  input: {
    bundle: ReplaySessionBundle;
    bundlePath: string;
    input: CandidateBundleInput;
    repoRoot: string;
    step: OfflineReviewPreparedStep;
    normalized: ReplayNormalizedEventSnapshot | null;
    semantic: ReplaySemanticSnapshot | null;
    decision: ReplayDecisionSnapshot | null;
  },
): SemanticReviewCandidate {
  const interpretation = input.semantic?.interpretation;

  return {
    kind,
    pressureScore: scoreCandidate(kind, input.step, input.semantic, input.decision),
    bundlePath: input.bundlePath,
    sessionId: input.bundle.sessionId,
    title: input.bundle.title,
    ...(input.bundle.source
      ? {
          source: {
            ...(input.bundle.source.id ? { id: input.bundle.source.id } : {}),
            ...(input.bundle.source.label ? { label: input.bundle.source.label } : {}),
          },
        }
      : {}),
    ...publicCorpusCandidateSource(input.input, input.repoRoot),
    stepIndex: input.step.stepIndex,
    ...(input.step.stepLabel ? { stepLabel: input.step.stepLabel } : {}),
    sourceExcerpt: input.step.sourceExcerpt,
    event: {
      type: input.normalized?.event.type ?? input.step.sourceEvent?.type ?? null,
      status: input.step.normalizedEvent?.status ?? input.step.sourceEvent?.status ?? null,
      title: input.step.normalizedEvent?.title ?? input.step.sourceEvent?.title ?? null,
      summary: input.step.normalizedEvent?.summary ?? input.step.sourceEvent?.summary ?? null,
      toolFamily:
        input.step.normalizedEvent?.toolFamily ?? input.step.sourceEvent?.toolFamily ?? null,
    },
    semantic: {
      intentFrame: interpretation?.intentFrame ?? null,
      activityClass: interpretation?.activityClass ?? null,
      toolFamily: interpretation?.toolFamily ?? null,
      consequence: interpretation?.consequence ?? null,
      confidence: interpretation?.confidence ?? null,
      whyNow: interpretation?.whyNow ?? null,
      relationKinds: interpretation?.relationHints.map((hint) => hint.kind) ?? [],
      provenance: Object.fromEntries(Object.entries(interpretation?.provenance ?? {})),
    },
    judgment: {
      evaluationKind: input.decision?.evaluationKind ?? null,
      decisionKind: input.decision?.decisionKind ?? null,
      plannedLane: input.decision?.plannedLane ?? null,
      resultLane: input.decision?.resultLane ?? null,
      semanticConfidence: input.decision?.semanticConfidence ?? null,
      semanticAbstained: input.decision?.semanticAbstained ?? null,
      ambiguityReason: input.decision?.ambiguity?.reason ?? null,
      ambiguityResolution: input.decision?.ambiguity?.resolution ?? null,
      reasonCodes: input.decision?.decisionRecordReasonCodes ?? [],
    },
    reviewFocusAreas: focusAreasForCandidateKind(kind),
    reviewRationale: rationaleForCandidateKind(kind),
  };
}

export function retainSemanticReviewCandidate(
  bucket: SemanticReviewCandidate[],
  candidate: SemanticReviewCandidate,
  limits: {
    maxCandidatesPerKind: number;
    maxCandidatesPerSessionPerKind: number;
  },
): SemanticReviewCandidate[] {
  const next = [...bucket, candidate].sort(compareCandidates);
  const retained: SemanticReviewCandidate[] = [];
  const perSession = new Map<string, number>();

  for (const entry of next) {
    const sessionCount = perSession.get(entry.sessionId) ?? 0;
    if (sessionCount >= limits.maxCandidatesPerSessionPerKind) {
      continue;
    }
    retained.push(entry);
    perSession.set(entry.sessionId, sessionCount + 1);
    if (retained.length >= limits.maxCandidatesPerKind) {
      break;
    }
  }

  return retained;
}

export function createKindCounts(): Record<SemanticReviewCandidateKind, number> {
  return Object.fromEntries(SEMANTIC_REVIEW_CANDIDATE_KINDS.map((kind) => [kind, 0])) as Record<
    SemanticReviewCandidateKind,
    number
  >;
}

export function createKindBuckets(): Record<SemanticReviewCandidateKind, SemanticReviewCandidate[]> {
  const buckets = {} as Record<SemanticReviewCandidateKind, SemanticReviewCandidate[]>;
  for (const kind of SEMANTIC_REVIEW_CANDIDATE_KINDS) {
    buckets[kind] = [];
  }
  return buckets;
}

export function sumCandidateCounts(counts: Record<SemanticReviewCandidateKind, number>): number {
  return SEMANTIC_REVIEW_CANDIDATE_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
}

function publicCorpusCandidateSource(
  input: CandidateBundleInput,
  repoRoot: string,
): Pick<SemanticReviewCandidate, "publicCorpus"> {
  const record = input.record;
  if (!record) {
    return {};
  }

  return {
    publicCorpus: {
      ...(input.manifestPath
        ? { manifestPath: repoRelativePath(input.manifestPath, repoRoot) }
        : {}),
      offset: record.offset,
      rowIndex: record.rowIndex,
      recordId: record.recordId,
      sourceIdentity: record.sourceIdentity,
      rowDigest: record.rowDigest,
      ...(record.bundleDigest ? { bundleDigest: record.bundleDigest } : {}),
      ...(record.canonicalSessionDigest
        ? { canonicalSessionDigest: record.canonicalSessionDigest }
        : {}),
    },
  };
}

function scoreCandidate(
  kind: SemanticReviewCandidateKind,
  step: OfflineReviewPreparedStep,
  semantic: ReplaySemanticSnapshot | null,
  decision: ReplayDecisionSnapshot | null,
): number {
  const interpretation = semantic?.interpretation;
  const sourceStatus = step.normalizedEvent?.status ?? step.sourceEvent?.status ?? null;
  let score = baseScoreForCandidateKind(kind);

  if (interpretation?.consequence === "high") {
    score += 40;
  } else if (interpretation?.consequence === "medium") {
    score += 20;
  }
  if (decision?.resultLane === "now" || decision?.plannedLane === "now") {
    score += 25;
  }
  if (decision?.decisionKind === "queue" || decision?.plannedLane === "next") {
    score += 20;
  }
  if (sourceStatus === "failed" || interpretation?.intentFrame === "failure") {
    score += 20;
  }
  if (
    sourceStatus === "blocked" ||
    interpretation?.intentFrame === "blocked_work" ||
    step.apertureRead?.blocking === "blocking"
  ) {
    score += 22;
  }
  if (interpretation?.confidence === "low" || decision?.semanticConfidence === "low") {
    score += 20;
  } else if (interpretation?.confidence === "medium" || decision?.semanticConfidence === "medium") {
    score += 10;
  }
  if ((interpretation?.relationHints.length ?? 0) > 0) {
    score += 8;
  }
  if (
    step.sourceExcerpt &&
    /approval|blocked|cannot|failed|failure|traceback|error|timeout/i.test(step.sourceExcerpt)
  ) {
    score += 6;
  }

  return score;
}

function baseScoreForCandidateKind(kind: SemanticReviewCandidateKind): number {
  switch (kind) {
    case "queue_decision":
      return 60;
    case "blocked_attention":
      return 55;
    case "semantic_uncertainty":
      return 50;
    case "high_consequence_attention":
      return 45;
    case "failure_attention":
      return 40;
    case "relation_signal":
      return 32;
    case "tool_taxonomy_gap":
      return 25;
    case "missing_why_now":
      return 10;
  }
}

function focusAreasForCandidateKind(kind: SemanticReviewCandidateKind): OfflineReviewFocusArea[] {
  switch (kind) {
    case "missing_why_now":
      return ["summary", "status", "intentFrame", "consequence", "confidence"];
    case "high_consequence_attention":
      return ["status", "intentFrame", "consequence", "confidence"];
    case "failure_attention":
      return ["status", "intentFrame", "toolFamily", "consequence"];
    case "blocked_attention":
      return ["status", "blocking", "intentFrame", "confidence"];
    case "queue_decision":
      return ["blocking", "episode", "confidence", "consequence"];
    case "semantic_uncertainty":
      return ["intentFrame", "blocking", "confidence", "source"];
    case "tool_taxonomy_gap":
      return ["toolFamily", "intentFrame", "consequence"];
    case "relation_signal":
      return ["episode", "status", "intentFrame", "source"];
  }
}

function rationaleForCandidateKind(kind: SemanticReviewCandidateKind): string {
  switch (kind) {
    case "missing_why_now":
      return "Semantic interpretation lacks whyNow timing language; review only if the event should explain attention timing.";
    case "high_consequence_attention":
      return "High-consequence or now-lane attention should be checked for calibrated urgency.";
    case "failure_attention":
      return "Failure events are common corpus pressure points for consequence and status interpretation.";
    case "blocked_attention":
      return "Blocked-like wording/status should be checked for blocking-vs-waiting precision.";
    case "queue_decision":
      return "Queued decisions are rare in this corpus and should be inspected for routing correctness.";
    case "semantic_uncertainty":
      return "Lower confidence, abstention, or ambiguity identifies language that may deserve review coverage.";
    case "tool_taxonomy_gap":
      return "Unknown tool families point at importer or semantic taxonomy gaps.";
    case "relation_signal":
      return "Relation hints exercise continuity semantics and should be sampled for target accuracy.";
  }
}

function compareCandidates(left: SemanticReviewCandidate, right: SemanticReviewCandidate): number {
  return (
    right.pressureScore - left.pressureScore ||
    left.bundlePath.localeCompare(right.bundlePath) ||
    left.stepIndex - right.stepIndex
  );
}

function hasNonEmptyWhyNow(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasToolTaxonomyGap(toolFamily: string | null | undefined): boolean {
  return typeof toolFamily === "string" && !KNOWN_TOOL_FAMILIES.has(toolFamily);
}

function repoRelativePath(filePath: string, repoRoot: string): string {
  const absolute = path.resolve(filePath);
  const relative = path.relative(repoRoot, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return absolute;
  }
  return relative;
}
