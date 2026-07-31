import {
  hasLimitedFailureStatusSemantics,
  hasRoutineObservationalStatusConflictSemantics,
  readCandidateSemanticEvidence,
} from "../judgment-input.js";
import type { AttentionCandidate } from "../interaction-candidate.js";

type PeripheralPolicyVerdict = {
  mayInterrupt: boolean;
  minimumLane: "ambient" | "next" | "now";
};

export function isSoftenedFailureStatusCandidate(candidate: AttentionCandidate): boolean {
  return (
    candidate.mode === "status" &&
    candidate.responseSpec.kind === "acknowledge" &&
    hasLimitedFailureStatusSemantics(candidate)
  );
}

export function isEstablishedPolicyPeripheralStatus(
  candidate: AttentionCandidate,
  policyVerdict: PeripheralPolicyVerdict,
): boolean {
  return (
    candidate.mode === "status" &&
    !policyVerdict.mayInterrupt &&
    (policyVerdict.minimumLane === "ambient"
      ? hasStableSemanticStatusEvidence(candidate)
      : policyVerdict.minimumLane === "next" && isSoftenedFailureStatusCandidate(candidate))
  );
}

function hasStableSemanticStatusEvidence(candidate: AttentionCandidate): boolean {
  const semanticEvidence = readCandidateSemanticEvidence(candidate);
  return (
    hasRoutineObservationalStatusConflictSemantics(candidate) ||
    (semanticEvidence !== null &&
      semanticEvidence.strength !== "weak" &&
      !semanticEvidence.abstained)
  );
}
