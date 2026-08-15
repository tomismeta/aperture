import type { TaskStatus } from "./events.js";
import { TRUNCATED_SOURCE_EVIDENCE_FACTOR } from "./semantic-types.js";

export type TruncatedSourceEvidenceHintOptions = {
  status?: TaskStatus;
  reason?: string;
};

export type TruncatedSourceEvidenceHints = {
  confidence: "low";
  factors: [typeof TRUNCATED_SOURCE_EVIDENCE_FACTOR];
  reasons?: string[];
};

export function semanticHintsForTruncatedSourceEvidence(
  options: TruncatedSourceEvidenceHintOptions = {},
): TruncatedSourceEvidenceHints {
  return {
    confidence: "low",
    factors: [TRUNCATED_SOURCE_EVIDENCE_FACTOR],
    reasons: [
      options.reason ??
        `source ${options.status === "failed" ? "failure " : ""}evidence was truncated before Aperture saw the full output`,
    ],
  };
}
