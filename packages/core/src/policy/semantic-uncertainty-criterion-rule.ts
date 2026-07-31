import {
  hasActionableBlockedLikeStatusSemantics,
  hasRoutineObservationalStatusConflictSemantics,
  isCandidateSemanticAbstained,
  readCandidateSemanticConfidence,
  readCandidateSemanticEvidence,
  readSemanticEvidenceStrength,
} from "../judgment-input.js";
import type { AttentionView } from "../frame.js";
import { findVisibleEpisodeFrames } from "../episode-tracker.js";
import {
  ambiguousPeripheralCriterionVerdict,
  noopPolicyCriterionRule,
  verdictPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";

export const evaluateSemanticUncertaintyCriterionRule: PolicyCriterionRule = (input) => {
  const { candidate, criterion, evidence, peripheralResolution } = input;
  const resolution = resolveSemanticUncertaintyPeripheralResolution(
    candidate,
    evidence.attentionView,
    peripheralResolution,
  );

  if (candidate.blocking) {
    return noopPolicyCriterionRule("semantic_uncertainty");
  }

  if (hasActionableBlockedLikeStatusSemantics(candidate)) {
    return noopPolicyCriterionRule("semantic_uncertainty", [
      "blocked-like status semantics are concrete enough to remain eligible for ordinary interrupt rules",
    ]);
  }

  if (hasRoutineObservationalStatusConflictSemantics(candidate)) {
    return noopPolicyCriterionRule("semantic_uncertainty", [
      "observational status-conflict evidence already owns peripheral status routing",
    ]);
  }

  if (hasVisibleDiagnosticFailureEvidence(candidate)) {
    return noopPolicyCriterionRule("semantic_uncertainty", [
      "visible diagnostic failure evidence is concrete enough for ordinary interrupt rules",
    ]);
  }

  if (isCandidateSemanticAbstained(candidate)) {
    return verdictPolicyCriterionRule(
      "semantic_uncertainty",
      ambiguousPeripheralCriterionVerdict(
        criterion,
        resolution,
        {
          kind: "interrupt",
          reason: "low_signal",
          resolution,
        },
        [
          "semantic interpretation abstained, so non-blocking work stays peripheral until stronger explicit evidence arrives",
        ],
      ),
    );
  }

  if (readCandidateSemanticConfidence(candidate) === "low") {
    return verdictPolicyCriterionRule(
      "semantic_uncertainty",
      ambiguousPeripheralCriterionVerdict(
        criterion,
        resolution,
        {
          kind: "interrupt",
          reason: "low_signal",
          resolution,
        },
        [
          "low-confidence semantic interpretation keeps non-blocking work peripheral until the signal is clearer",
        ],
      ),
    );
  }

  if (readSemanticEvidenceStrength(candidate) === "weak") {
    return verdictPolicyCriterionRule(
      "semantic_uncertainty",
      ambiguousPeripheralCriterionVerdict(
        criterion,
        resolution,
        {
          kind: "interrupt",
          reason: "low_signal",
          resolution,
        },
        [
          "inferred semantic evidence stays peripheral until stronger source-backed context arrives",
        ],
      ),
    );
  }

  return noopPolicyCriterionRule(
    "semantic_uncertainty",
    readCandidateSemanticEvidence(candidate) !== null
      ? ["semantic evidence is strong enough to keep ordinary interrupt rules in play"]
      : [],
  );
};

function hasVisibleDiagnosticFailureEvidence(
  candidate: Parameters<PolicyCriterionRule>[0]["candidate"],
): boolean {
  return candidate.judgmentInput.failureEvidence?.failureDetail === "diagnostic";
}

function resolveSemanticUncertaintyPeripheralResolution(
  candidate: Parameters<PolicyCriterionRule>[0]["candidate"],
  attentionView: AttentionView,
  fallback: "queue" | "ambient",
): "queue" | "ambient" {
  if (
    fallback === "queue" &&
    candidate.mode === "status" &&
    candidate.episodeId !== undefined &&
    hasVisibleNowEpisodeFrame(candidate.episodeId, candidate.interactionId, attentionView)
  ) {
    return "ambient";
  }

  return fallback;
}

function hasVisibleNowEpisodeFrame(
  episodeId: string,
  interactionId: string,
  attentionView: AttentionView,
): boolean {
  return (
    findVisibleEpisodeFrames(attentionView, episodeId, {
      lanes: ["now"],
      excludedInteractionId: interactionId,
    }).length > 0
  );
}
