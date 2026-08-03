import {
  hasObservationalStatusConflictSemantics,
  readCandidateObservationJudgmentContract,
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
    readCandidateObservationJudgmentContract(candidate)?.limitedFailureStatus === true
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
  if (hasObservationalStatusConflictSemantics(candidate)) {
    return true;
  }

  const observationContract = readCandidateObservationJudgmentContract(candidate);
  if (observationContract !== null) {
    return observationContract.stableStatusEvidence;
  }

  const semanticEvidence = readCandidateSemanticEvidence(candidate);
  return (
    semanticEvidence !== null && semanticEvidence.strength !== "weak" && !semanticEvidence.abstained
  );
}
