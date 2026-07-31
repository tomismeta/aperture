import type { TaskStatus } from "./events.js";
import type { SemanticConsequenceLevel, SemanticInterpretationHints } from "./semantic-types.js";

export const TRUNCATED_SOURCE_EVIDENCE_FACTOR = "source evidence truncated";

export type TruncatedSourceEvidenceHintOptions = {
  status?: TaskStatus;
  consequence?: SemanticConsequenceLevel | false;
  reason?: string;
};

export function semanticHintsForTruncatedSourceEvidence(
  options: TruncatedSourceEvidenceHintOptions = {},
): SemanticInterpretationHints {
  const consequence = truncatedSourceEvidenceConsequence(options);

  return {
    ...(consequence !== undefined ? { consequence } : {}),
    confidence: "low",
    factors: [TRUNCATED_SOURCE_EVIDENCE_FACTOR],
    reasons: [options.reason ?? defaultTruncatedSourceEvidenceReason(options.status)],
  };
}

function truncatedSourceEvidenceConsequence(
  options: TruncatedSourceEvidenceHintOptions,
): SemanticConsequenceLevel | undefined {
  if (options.consequence === false) {
    return undefined;
  }
  if (options.consequence !== undefined) {
    return options.consequence;
  }
  return options.status === "failed" ? "high" : undefined;
}

function defaultTruncatedSourceEvidenceReason(status: TaskStatus | undefined): string {
  return status === "failed"
    ? "source failure evidence was truncated before Aperture saw the full output"
    : "source evidence was truncated before Aperture saw the full output";
}
