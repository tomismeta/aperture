import { isCandidateTrace, type ApertureTrace } from "@tomismeta/aperture-core/internal";

import { normalizeReplayRun, type NormalizedReplayRun } from "./determinism.js";
import {
  digestKernelCanonicalJson,
  type KernelCanonicalJsonDigest,
} from "./kernel-canonical-json.js";
import type { ReplayDecisionSnapshot, ReplaySemanticSnapshot } from "./scenario.js";
import { runSessionBundle } from "./session-bundle-scenarios.js";
import type { ReplaySessionBundle } from "./session-bundle-model.js";
import { scoreReplayRun, type ReplayScorecard } from "./scorecard.js";

export const SESSION_REPLAY_AUDIT_SCHEMA_VERSION = 1 as const;

export type SessionReplayAuditStatus = "candidate" | "inspect" | "observe";
export type SessionReplayComparisonStatus =
  | "match"
  | "mismatch"
  | "unavailable"
  | "incompatible_version";
export type SessionReplayDecisionDriftField =
  | "route"
  | "planned_lane"
  | "result_lane"
  | "candidate_score"
  | "reason_codes";

export type SessionReplayAuditInput =
  | ReplaySessionBundle
  | {
      bundle: ReplaySessionBundle;
      path?: string;
    };

export type SessionReplayAudit = {
  schemaVersion: typeof SESSION_REPLAY_AUDIT_SCHEMA_VERSION;
  sessionId: string;
  title: string;
  path: string | null;
  doctrineTags: string[];
  sourceId: string | null;
  inputDigest: KernelCanonicalJsonDigest;
  coverage: SessionReplayAuditCoverage;
  repeatability: SessionReplayRepeatabilityAudit;
  fidelity: SessionReplayFidelityAudit;
  pressure: SessionReplayPressureAudit;
  review: SessionReplayReviewRecommendation;
};

export type SessionReplayAuditCoverage = {
  steps: number;
  sourceEvents: number;
  candidateDecisions: number;
  capturedDecisions: number;
  replayedDecisions: number;
  capturedSemanticSnapshots: number;
  replayedSemanticSnapshots: number;
  comparableDecisionFingerprints: number;
  comparableSemanticSnapshots: number;
};

export type SessionReplayRepeatabilityAudit = {
  stable: boolean;
  driftAreas: string[];
};

export type SessionReplayFidelityAudit = {
  finalView: {
    status: Extract<SessionReplayComparisonStatus, "match" | "mismatch">;
    captured: SessionReplayFinalView;
    replayed: SessionReplayFinalView;
  };
  decisions: {
    fingerprintStatusCounts: Record<SessionReplayComparisonStatus, number>;
    comparisons: SessionReplayDecisionComparison[];
    missingCapturedStepIndices: number[];
    missingReplayedStepIndices: number[];
    duplicateCapturedStepIndices: number[];
    duplicateReplayedStepIndices: number[];
    fieldDriftStepIndices: number[];
  };
  semantics: {
    statusCounts: Record<Exclude<SessionReplayComparisonStatus, "incompatible_version">, number>;
    comparisons: SessionReplaySemanticComparison[];
    duplicateCapturedStepIndices: number[];
    duplicateReplayedStepIndices: number[];
  };
};

export type SessionReplayFinalView = {
  nowInteractionId: string | null;
  nextInteractionIds: string[];
  ambientInteractionIds: string[];
};

export type SessionReplayDecisionComparison = {
  stepIndex: number;
  fingerprintStatus: SessionReplayComparisonStatus;
  fieldDrifts: SessionReplayDecisionDriftField[];
  captured?: SessionReplayDecisionComparable;
  replayed?: SessionReplayDecisionComparable;
};

export type SessionReplayDecisionComparable = {
  route: string | null;
  plannedLane: string | null;
  resultLane: string | null;
  candidateScore: number | null;
  reasonCodes: string[] | null;
  fingerprint: string | null;
  projectionVersion: number | null;
};

export type SessionReplaySemanticComparison = {
  stepIndex: number;
  status: Exclude<SessionReplayComparisonStatus, "incompatible_version">;
  captured?: SessionReplaySemanticComparable;
  replayed?: SessionReplaySemanticComparable;
};

export type SessionReplaySemanticComparable = {
  intentFrame: string;
  activityClass: string | null;
  toolFamily: string | null;
  consequence: string | null;
  confidence: string;
  abstained: boolean;
  relationHints: Array<{ kind: string; target: string | null }>;
  ontology: SessionReplayOntologyComparable | null;
};

export type SessionReplayOntologyComparable = {
  ask: string;
  activity: string;
  consequence: string | null;
  blocking: string;
  episode: string;
  confidence: string;
  source: string;
};

export type SessionReplayPressureAudit = {
  semanticSourceEvents: number;
  relationHintedSteps: number;
  relationKinds: Record<string, number>;
  lowConfidenceDecisions: number;
  abstainedDecisions: number;
  ambiguousDecisions: number;
  ambiguousRecoveries: number;
  continuityOverrides: number;
  mergedEpisodeUpdates: number;
  deferredThenActivated: number;
  suppressedThenActivated: number;
  activeWorkLeft: number;
  routeCounts: Record<string, number>;
  resultLaneCounts: {
    now: number;
    next: number;
    ambient: number;
  };
};

export type SessionReplayReviewRecommendation = {
  status: SessionReplayAuditStatus;
  cues: string[];
  rationale: string[];
};

export type SessionReplayAuditReport = {
  schemaVersion: typeof SESSION_REPLAY_AUDIT_SCHEMA_VERSION;
  audits: SessionReplayAudit[];
  duplicateSessionIds: SessionReplayDuplicateGroup[];
  duplicateInputDigests: SessionReplayDuplicateGroup[];
  summary: {
    totalBundles: number;
    candidateBundles: number;
    inspectBundles: number;
    observeBundles: number;
    repeatableBundles: number;
    repeatabilityDriftedBundles: number;
    finalViewDriftedBundles: number;
    semanticDriftedBundles: number;
    decisionDriftedBundles: number;
    unavailableFingerprints: number;
    comparableFingerprints: number;
    totalSteps: number;
    ambiguousDecisions: number;
    ambiguousRecoveries: number;
    lowConfidenceDecisions: number;
    continuityOverrides: number;
    mergedEpisodeUpdates: number;
  };
};

export type SessionReplayDuplicateGroup = {
  key: string;
  sessionIds: string[];
  paths: string[];
};

type StepIndexComparisonResult<TComparison> = {
  comparisons: TComparison[];
  duplicateCapturedStepIndices: number[];
  duplicateReplayedStepIndices: number[];
};

export function auditSessionBundleReplays(
  inputs: readonly SessionReplayAuditInput[],
): SessionReplayAuditReport {
  const audits = inputs.map((input) => auditSessionBundleReplay(input));
  const duplicateSessionIds = collectDuplicateSessionIds(audits);
  const duplicateInputDigests = collectDuplicateInputDigests(audits);

  return {
    schemaVersion: SESSION_REPLAY_AUDIT_SCHEMA_VERSION,
    audits,
    duplicateSessionIds,
    duplicateInputDigests,
    summary: {
      totalBundles: audits.length,
      candidateBundles: countAudits(audits, "candidate"),
      inspectBundles: countAudits(audits, "inspect"),
      observeBundles: countAudits(audits, "observe"),
      repeatableBundles: audits.filter((audit) => audit.repeatability.stable).length,
      repeatabilityDriftedBundles: audits.filter((audit) => !audit.repeatability.stable).length,
      finalViewDriftedBundles: audits.filter(
        (audit) => audit.fidelity.finalView.status === "mismatch",
      ).length,
      semanticDriftedBundles: audits.filter(
        (audit) => audit.fidelity.semantics.statusCounts.mismatch > 0,
      ).length,
      decisionDriftedBundles: audits.filter((audit) => hasDecisionDrift(audit)).length,
      unavailableFingerprints: sum(
        audits.map((audit) => audit.fidelity.decisions.fingerprintStatusCounts.unavailable),
      ),
      comparableFingerprints: sum(
        audits.map((audit) => audit.coverage.comparableDecisionFingerprints),
      ),
      totalSteps: sum(audits.map((audit) => audit.coverage.steps)),
      ambiguousDecisions: sum(audits.map((audit) => audit.pressure.ambiguousDecisions)),
      ambiguousRecoveries: sum(audits.map((audit) => audit.pressure.ambiguousRecoveries)),
      lowConfidenceDecisions: sum(audits.map((audit) => audit.pressure.lowConfidenceDecisions)),
      continuityOverrides: sum(audits.map((audit) => audit.pressure.continuityOverrides)),
      mergedEpisodeUpdates: sum(audits.map((audit) => audit.pressure.mergedEpisodeUpdates)),
    },
  };
}

export function auditSessionBundleReplay(input: SessionReplayAuditInput): SessionReplayAudit {
  const { bundle, path } = normalizeAuditInput(input);
  const replayA = runSessionBundle(bundle);
  const replayB = runSessionBundle(bundle);
  const scorecard = scoreReplayRun(replayA);
  const fidelity = buildSessionReplayFidelity(
    bundle,
    scorecard,
    replayA.decisions,
    replayA.semantics,
  );
  const pressure = buildSessionReplayPressure(
    scorecard,
    replayA.decisions,
    replayA.semantics,
    replayA.traces,
  );
  const repeatability = compareReplayRepeatability(
    normalizeReplayRun(replayA),
    normalizeReplayRun(replayB),
  );
  const coverage = buildSessionReplayCoverage(
    bundle,
    replayA.decisions,
    replayA.semantics,
    fidelity,
  );

  return {
    schemaVersion: SESSION_REPLAY_AUDIT_SCHEMA_VERSION,
    sessionId: bundle.sessionId,
    title: bundle.title,
    path: path ?? null,
    doctrineTags: [...(bundle.doctrineTags ?? [])],
    sourceId: bundle.source?.id ?? null,
    inputDigest: digestKernelCanonicalJson(bundle.steps),
    coverage,
    repeatability,
    fidelity,
    pressure,
    review: recommendSessionReview(repeatability, fidelity, pressure),
  };
}

function buildSessionReplayCoverage(
  bundle: ReplaySessionBundle,
  decisions: readonly ReplayDecisionSnapshot[],
  semantics: readonly ReplaySemanticSnapshot[],
  fidelity: SessionReplayFidelityAudit,
): SessionReplayAuditCoverage {
  return {
    steps: bundle.steps.length,
    sourceEvents: bundle.steps.filter((step) => step.kind === "publishSource").length,
    candidateDecisions: decisions.filter((decision) => decision.evaluationKind === "candidate")
      .length,
    capturedDecisions: bundle.decisionSnapshots.length,
    replayedDecisions: decisions.length,
    capturedSemanticSnapshots: bundle.semanticSnapshots.length,
    replayedSemanticSnapshots: semantics.length,
    comparableDecisionFingerprints:
      fidelity.decisions.fingerprintStatusCounts.match +
      fidelity.decisions.fingerprintStatusCounts.mismatch,
    comparableSemanticSnapshots:
      fidelity.semantics.statusCounts.match + fidelity.semantics.statusCounts.mismatch,
  };
}

function compareReplayRepeatability(
  left: NormalizedReplayRun,
  right: NormalizedReplayRun,
): SessionReplayRepeatabilityAudit {
  const driftAreas = [
    ...(!sameValue(left.finalView, right.finalView) ? ["final_view"] : []),
    ...(!sameValue(left.traces, right.traces) ? ["traces"] : []),
    ...(!sameValue(left.semantics, right.semantics) ? ["semantics"] : []),
    ...(!sameValue(left.decisions, right.decisions) ? ["decisions"] : []),
    ...(!sameValue(left.signals, right.signals) ? ["signals"] : []),
    ...(!sameValue(left.responses, right.responses) ? ["responses"] : []),
  ];

  return {
    stable: driftAreas.length === 0,
    driftAreas,
  };
}

function buildSessionReplayFidelity(
  bundle: ReplaySessionBundle,
  scorecard: ReplayScorecard,
  replayedDecisions: readonly ReplayDecisionSnapshot[],
  replayedSemantics: readonly ReplaySemanticSnapshot[],
): SessionReplayFidelityAudit {
  const finalView = {
    captured: finalViewFromBundle(bundle),
    replayed: finalViewFromScorecard(scorecard),
  };
  const decisionAudit = compareDecisionsByStepIndex(bundle.decisionSnapshots, replayedDecisions);
  const semanticAudit = compareSemanticsByStepIndex(bundle.semanticSnapshots, replayedSemantics);

  return {
    finalView: {
      ...finalView,
      status: sameValue(finalView.captured, finalView.replayed) ? "match" : "mismatch",
    },
    decisions: {
      fingerprintStatusCounts: countDecisionFingerprintStatuses(decisionAudit.comparisons),
      comparisons: decisionAudit.comparisons,
      missingCapturedStepIndices: decisionAudit.comparisons
        .filter((comparison) => !comparison.captured)
        .map((comparison) => comparison.stepIndex),
      missingReplayedStepIndices: decisionAudit.comparisons
        .filter((comparison) => !comparison.replayed)
        .map((comparison) => comparison.stepIndex),
      duplicateCapturedStepIndices: decisionAudit.duplicateCapturedStepIndices,
      duplicateReplayedStepIndices: decisionAudit.duplicateReplayedStepIndices,
      fieldDriftStepIndices: decisionAudit.comparisons
        .filter((comparison) => comparison.fieldDrifts.length > 0)
        .map((comparison) => comparison.stepIndex),
    },
    semantics: {
      statusCounts: countSemanticStatuses(semanticAudit.comparisons),
      comparisons: semanticAudit.comparisons,
      duplicateCapturedStepIndices: semanticAudit.duplicateCapturedStepIndices,
      duplicateReplayedStepIndices: semanticAudit.duplicateReplayedStepIndices,
    },
  };
}

function compareDecisionsByStepIndex(
  capturedDecisions: readonly ReplayDecisionSnapshot[],
  replayedDecisions: readonly ReplayDecisionSnapshot[],
): StepIndexComparisonResult<SessionReplayDecisionComparison> {
  const capturedIndex = indexByStepIndex(capturedDecisions);
  const replayedIndex = indexByStepIndex(replayedDecisions);

  return {
    comparisons: unionStepIndices(capturedIndex.byStep, replayedIndex.byStep).map((stepIndex) => {
      const captured = capturedIndex.byStep.get(stepIndex);
      const replayed = replayedIndex.byStep.get(stepIndex);
      const capturedComparable = captured ? comparableDecision(captured) : undefined;
      const replayedComparable = replayed ? comparableDecision(replayed) : undefined;

      return {
        stepIndex,
        fingerprintStatus: compareDecisionFingerprint(capturedComparable, replayedComparable),
        fieldDrifts:
          capturedComparable && replayedComparable
            ? compareDecisionFields(capturedComparable, replayedComparable)
            : [],
        ...(capturedComparable ? { captured: capturedComparable } : {}),
        ...(replayedComparable ? { replayed: replayedComparable } : {}),
      };
    }),
    duplicateCapturedStepIndices: capturedIndex.duplicateStepIndices,
    duplicateReplayedStepIndices: replayedIndex.duplicateStepIndices,
  };
}

function compareSemanticsByStepIndex(
  capturedSemantics: readonly ReplaySemanticSnapshot[],
  replayedSemantics: readonly ReplaySemanticSnapshot[],
): StepIndexComparisonResult<SessionReplaySemanticComparison> {
  const capturedIndex = indexByStepIndex(capturedSemantics);
  const replayedIndex = indexByStepIndex(replayedSemantics);

  return {
    comparisons: unionStepIndices(capturedIndex.byStep, replayedIndex.byStep).map((stepIndex) => {
      const captured = capturedIndex.byStep.get(stepIndex);
      const replayed = replayedIndex.byStep.get(stepIndex);
      const capturedComparable = captured ? comparableSemantic(captured) : undefined;
      const replayedComparable = replayed ? comparableSemantic(replayed) : undefined;

      return {
        stepIndex,
        status: compareSemanticSnapshot(capturedComparable, replayedComparable),
        ...(capturedComparable ? { captured: capturedComparable } : {}),
        ...(replayedComparable ? { replayed: replayedComparable } : {}),
      };
    }),
    duplicateCapturedStepIndices: capturedIndex.duplicateStepIndices,
    duplicateReplayedStepIndices: replayedIndex.duplicateStepIndices,
  };
}

function compareDecisionFingerprint(
  captured: SessionReplayDecisionComparable | undefined,
  replayed: SessionReplayDecisionComparable | undefined,
): SessionReplayComparisonStatus {
  if (!captured?.fingerprint || !replayed?.fingerprint) {
    return "unavailable";
  }

  if (
    captured.projectionVersion !== null &&
    replayed.projectionVersion !== null &&
    captured.projectionVersion !== replayed.projectionVersion
  ) {
    return "incompatible_version";
  }

  return captured.fingerprint === replayed.fingerprint ? "match" : "mismatch";
}

function compareDecisionFields(
  captured: SessionReplayDecisionComparable,
  replayed: SessionReplayDecisionComparable,
): SessionReplayDecisionDriftField[] {
  return [
    ...(isComparableValue(captured.route, replayed.route) && captured.route !== replayed.route
      ? ["route" as const]
      : []),
    ...(isComparableValue(captured.plannedLane, replayed.plannedLane) &&
    captured.plannedLane !== replayed.plannedLane
      ? ["planned_lane" as const]
      : []),
    ...(isComparableValue(captured.resultLane, replayed.resultLane) &&
    captured.resultLane !== replayed.resultLane
      ? ["result_lane" as const]
      : []),
    ...(isComparableValue(captured.candidateScore, replayed.candidateScore) &&
    captured.candidateScore !== replayed.candidateScore
      ? ["candidate_score" as const]
      : []),
    ...(captured.reasonCodes !== null &&
    replayed.reasonCodes !== null &&
    !sameValue(captured.reasonCodes, replayed.reasonCodes)
      ? ["reason_codes" as const]
      : []),
  ];
}

function compareSemanticSnapshot(
  captured: SessionReplaySemanticComparable | undefined,
  replayed: SessionReplaySemanticComparable | undefined,
): Exclude<SessionReplayComparisonStatus, "incompatible_version"> {
  if (!captured || !replayed) {
    return "unavailable";
  }

  const interpretationMatches = sameValue(
    comparableSemanticInterpretation(captured),
    comparableSemanticInterpretation(replayed),
  );
  const ontologyStatus = compareAttentionOntology(captured.ontology, replayed.ontology);

  if (!interpretationMatches || ontologyStatus === "mismatch") {
    return "mismatch";
  }

  return ontologyStatus === "unavailable" ? "unavailable" : "match";
}

function compareAttentionOntology(
  captured: SessionReplayOntologyComparable | null,
  replayed: SessionReplayOntologyComparable | null,
): Exclude<SessionReplayComparisonStatus, "incompatible_version"> {
  if (!captured || !replayed) {
    return "unavailable";
  }

  return sameValue(captured, replayed) ? "match" : "mismatch";
}

function comparableSemanticInterpretation(
  snapshot: SessionReplaySemanticComparable,
): Omit<SessionReplaySemanticComparable, "ontology"> {
  return {
    intentFrame: snapshot.intentFrame,
    activityClass: snapshot.activityClass,
    toolFamily: snapshot.toolFamily,
    consequence: snapshot.consequence,
    confidence: snapshot.confidence,
    abstained: snapshot.abstained,
    relationHints: snapshot.relationHints,
  };
}

function comparableDecision(decision: ReplayDecisionSnapshot): SessionReplayDecisionComparable {
  return {
    route: decision.decisionRecordRoute ?? decision.decisionKind ?? null,
    plannedLane: decision.plannedLane ?? null,
    resultLane: decision.resultLane ?? null,
    candidateScore: decision.decisionRecordCandidateScore ?? null,
    reasonCodes: decision.decisionRecordReasonCodes
      ? [...decision.decisionRecordReasonCodes]
      : null,
    fingerprint: decision.decisionRecordFingerprint ?? null,
    projectionVersion: decision.decisionRecordProjectionVersion ?? null,
  };
}

function comparableSemantic(snapshot: ReplaySemanticSnapshot): SessionReplaySemanticComparable {
  return {
    intentFrame: snapshot.interpretation.intentFrame,
    activityClass: snapshot.interpretation.activityClass ?? null,
    toolFamily: snapshot.interpretation.toolFamily ?? null,
    consequence: snapshot.interpretation.consequence ?? null,
    confidence: snapshot.interpretation.confidence,
    abstained: snapshot.interpretation.abstained === true,
    relationHints: snapshot.interpretation.relationHints
      .map((hint) => ({
        kind: hint.kind,
        target: hint.target ?? null,
      }))
      .sort((left, right) =>
        `${left.kind}:${left.target ?? ""}`.localeCompare(`${right.kind}:${right.target ?? ""}`),
      ),
    ontology: snapshot.ontology ? comparableOntology(snapshot.ontology) : null,
  };
}

function comparableOntology(
  ontology: NonNullable<ReplaySemanticSnapshot["ontology"]>,
): SessionReplayOntologyComparable {
  return {
    ask: ontology.ask,
    activity: ontology.activity,
    consequence: ontology.consequence ?? null,
    blocking: ontology.blocking,
    episode: ontology.episode,
    confidence: ontology.confidence,
    source: ontology.source,
  };
}

function buildSessionReplayPressure(
  scorecard: ReplayScorecard,
  decisions: readonly ReplayDecisionSnapshot[],
  semantics: readonly ReplaySemanticSnapshot[],
  traces: readonly ApertureTrace[],
): SessionReplayPressureAudit {
  return {
    semanticSourceEvents: semantics.length,
    relationHintedSteps: semantics.filter(
      (semantic) => semantic.interpretation.relationHints.length > 0,
    ).length,
    relationKinds: countRelationKinds(semantics),
    lowConfidenceDecisions: decisions.filter((decision) => decision.semanticConfidence === "low")
      .length,
    abstainedDecisions: decisions.filter((decision) => decision.semanticAbstained === true).length,
    ambiguousDecisions: scorecard.trace.ambiguousDecisions,
    ambiguousRecoveries:
      scorecard.trace.ambiguousNextThenActivated + scorecard.trace.ambiguousAmbientThenActivated,
    continuityOverrides: countContinuityOverrides(traces),
    mergedEpisodeUpdates: scorecard.trace.mergedEpisodeUpdates,
    deferredThenActivated: scorecard.trace.deferredThenActivated,
    suppressedThenActivated: scorecard.trace.suppressedThenActivated,
    activeWorkLeft:
      (scorecard.outcomes.finalNowInteractionId ? 1 : 0) +
      scorecard.outcomes.finalNextCount +
      scorecard.outcomes.finalAmbientCount,
    routeCounts: countDecisionRoutes(decisions),
    resultLaneCounts: scorecard.lanes,
  };
}

function recommendSessionReview(
  repeatability: SessionReplayRepeatabilityAudit,
  fidelity: SessionReplayFidelityAudit,
  pressure: SessionReplayPressureAudit,
): SessionReplayReviewRecommendation {
  const inspectCues = [
    ...(!repeatability.stable ? ["repeatability_drift"] : []),
    ...(hasCaptureCorruption(fidelity) ? ["capture_corruption"] : []),
    ...(fidelity.finalView.status === "mismatch" ? ["final_view_drift"] : []),
    ...(fidelity.semantics.statusCounts.mismatch > 0 ? ["semantic_drift"] : []),
    ...(hasDecisionFidelityDrift(fidelity) ? ["decision_drift"] : []),
  ];
  const candidateCues = [
    ...(fidelity.decisions.fingerprintStatusCounts.unavailable > 0
      ? ["unavailable_capture_projection"]
      : []),
    ...(pressure.ambiguousDecisions > 0 ||
    pressure.lowConfidenceDecisions > 0 ||
    pressure.abstainedDecisions > 0
      ? ["uncertainty_edge"]
      : []),
    ...(pressure.relationHintedSteps > 0 ||
    pressure.continuityOverrides > 0 ||
    pressure.mergedEpisodeUpdates > 0
      ? ["continuity_edge"]
      : []),
    ...(pressure.deferredThenActivated > 0 || pressure.suppressedThenActivated > 0
      ? ["deferred_recovery"]
      : []),
    ...(pressure.activeWorkLeft > 0 ? ["incomplete_capture"] : []),
  ];
  const cues = uniqueStrings([...inspectCues, ...candidateCues]);

  if (inspectCues.length > 0) {
    return {
      status: "inspect",
      cues,
      rationale: buildReviewRationale(inspectCues, candidateCues),
    };
  }

  const promotionCues = candidateCues.filter(
    (cue) => cue !== "incomplete_capture" && cue !== "unavailable_capture_projection",
  );
  if (promotionCues.length > 0) {
    return {
      status: "candidate",
      cues,
      rationale: buildReviewRationale([], candidateCues),
    };
  }

  return {
    status: "observe",
    cues,
    rationale:
      candidateCues.length > 0
        ? buildReviewRationale([], candidateCues)
        : ["stable replay with no strong review pressure detected"],
  };
}

function buildReviewRationale(
  inspectCues: readonly string[],
  candidateCues: readonly string[],
): string[] {
  return [
    ...(inspectCues.length > 0
      ? [`inspect before review or promotion because ${inspectCues.join(", ")} appeared`]
      : []),
    ...(inspectCues.includes("capture_corruption")
      ? ["captured snapshots contain duplicate step indices and need repair"]
      : []),
    ...(candidateCues.includes("unavailable_capture_projection")
      ? ["some captured decisions do not have comparable historical fingerprints"]
      : []),
    ...(candidateCues.includes("uncertainty_edge")
      ? ["uncertainty handling was exercised by ambiguity, low confidence, or abstention"]
      : []),
    ...(candidateCues.includes("continuity_edge")
      ? ["continuity behavior was exercised by relation hints, overrides, or merged episodes"]
      : []),
    ...(candidateCues.includes("deferred_recovery")
      ? ["deferred or suppressed work later returned to now"]
      : []),
    ...(candidateCues.includes("incomplete_capture")
      ? ["session ended with visible work, so capture completeness should be checked"]
      : []),
  ];
}

function hasDecisionFidelityDrift(fidelity: SessionReplayFidelityAudit): boolean {
  return (
    fidelity.decisions.fingerprintStatusCounts.mismatch > 0 ||
    fidelity.decisions.fingerprintStatusCounts.incompatible_version > 0 ||
    fidelity.decisions.fieldDriftStepIndices.length > 0 ||
    fidelity.decisions.missingCapturedStepIndices.length > 0 ||
    fidelity.decisions.missingReplayedStepIndices.length > 0
  );
}

function hasCaptureCorruption(fidelity: SessionReplayFidelityAudit): boolean {
  return (
    fidelity.decisions.duplicateCapturedStepIndices.length > 0 ||
    fidelity.decisions.duplicateReplayedStepIndices.length > 0 ||
    fidelity.semantics.duplicateCapturedStepIndices.length > 0 ||
    fidelity.semantics.duplicateReplayedStepIndices.length > 0
  );
}

function hasDecisionDrift(audit: SessionReplayAudit): boolean {
  return hasDecisionFidelityDrift(audit.fidelity);
}

function countDecisionFingerprintStatuses(
  comparisons: readonly SessionReplayDecisionComparison[],
): Record<SessionReplayComparisonStatus, number> {
  return countStatuses(
    ["match", "mismatch", "unavailable", "incompatible_version"],
    comparisons,
    (comparison) => comparison.fingerprintStatus,
  );
}

function countSemanticStatuses(
  comparisons: readonly SessionReplaySemanticComparison[],
): Record<Exclude<SessionReplayComparisonStatus, "incompatible_version">, number> {
  return countStatuses(
    ["match", "mismatch", "unavailable"],
    comparisons,
    (comparison) => comparison.status,
  );
}

function countStatuses<TStatus extends string, TItem>(
  statuses: readonly TStatus[],
  items: readonly TItem[],
  readStatus: (item: TItem) => TStatus,
): Record<TStatus, number> {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<
    TStatus,
    number
  >;

  for (const item of items) {
    counts[readStatus(item)] += 1;
  }

  return counts;
}

function finalViewFromBundle(bundle: ReplaySessionBundle): SessionReplayFinalView {
  return {
    nowInteractionId: bundle.outcomes.finalNowInteractionId,
    nextInteractionIds: [...bundle.outcomes.finalNextInteractionIds],
    ambientInteractionIds: [...bundle.outcomes.finalAmbientInteractionIds],
  };
}

function finalViewFromScorecard(scorecard: ReplayScorecard): SessionReplayFinalView {
  return {
    nowInteractionId: scorecard.outcomes.finalNowInteractionId,
    nextInteractionIds: [...scorecard.outcomes.finalNextInteractionIds],
    ambientInteractionIds: [...scorecard.outcomes.finalAmbientInteractionIds],
  };
}

function countRelationKinds(semantics: readonly ReplaySemanticSnapshot[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const semantic of semantics) {
    for (const hint of semantic.interpretation.relationHints) {
      counts[hint.kind] = (counts[hint.kind] ?? 0) + 1;
    }
  }

  return sortedRecord(counts);
}

function countContinuityOverrides(traces: readonly ApertureTrace[]): number {
  let count = 0;

  for (const trace of traces) {
    if (!isCandidateTrace(trace)) {
      continue;
    }
    count += trace.coordination.continuityEvaluations.filter(
      (evaluation) => evaluation.kind === "override",
    ).length;
  }

  return count;
}

function countDecisionRoutes(decisions: readonly ReplayDecisionSnapshot[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const decision of decisions) {
    const route = decision.decisionRecordRoute ?? decision.decisionKind ?? decision.evaluationKind;
    counts[route] = (counts[route] ?? 0) + 1;
  }

  return sortedRecord(counts);
}

function collectDuplicateSessionIds(
  audits: readonly SessionReplayAudit[],
): SessionReplayDuplicateGroup[] {
  return collectDuplicateGroups(audits, (audit) => audit.sessionId);
}

function collectDuplicateInputDigests(
  audits: readonly SessionReplayAudit[],
): SessionReplayDuplicateGroup[] {
  return collectDuplicateGroups(audits, (audit) => audit.inputDigest).filter((group) => {
    return new Set(group.sessionIds).size > 1 || group.paths.length > 1;
  });
}

function collectDuplicateGroups(
  audits: readonly SessionReplayAudit[],
  readKey: (audit: SessionReplayAudit) => string,
): SessionReplayDuplicateGroup[] {
  const groups = new Map<string, SessionReplayAudit[]>();

  for (const audit of audits) {
    const key = readKey(audit);
    groups.set(key, [...(groups.get(key) ?? []), audit]);
  }

  return [...groups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => ({
      key,
      sessionIds: entries.map((entry) => entry.sessionId),
      paths: entries.map((entry) => entry.path).filter((entry): entry is string => entry !== null),
    }));
}

function normalizeAuditInput(input: SessionReplayAuditInput): {
  bundle: ReplaySessionBundle;
  path?: string;
} {
  return "bundle" in input ? input : { bundle: input };
}

function indexByStepIndex<T extends { stepIndex: number }>(
  items: readonly T[],
): {
  byStep: Map<number, T>;
  duplicateStepIndices: number[];
} {
  const byStep = new Map<number, T>();
  const duplicateStepIndices = new Set<number>();

  for (const item of items) {
    if (byStep.has(item.stepIndex)) {
      duplicateStepIndices.add(item.stepIndex);
      continue;
    }

    byStep.set(item.stepIndex, item);
  }

  return {
    byStep,
    duplicateStepIndices: [...duplicateStepIndices].sort((left, right) => left - right),
  };
}

function unionStepIndices(
  left: ReadonlyMap<number, unknown>,
  right: ReadonlyMap<number, unknown>,
): number[] {
  return [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a - b);
}

function countAudits(
  audits: readonly SessionReplayAudit[],
  status: SessionReplayAuditStatus,
): number {
  return audits.filter((audit) => audit.review.status === status).length;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sortedRecord(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isComparableValue<T>(left: T | null, right: T | null): left is T {
  return left !== null && right !== null;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
