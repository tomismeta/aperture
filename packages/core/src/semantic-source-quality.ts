import type { TaskStatus } from "./events.js";
import { TRUNCATED_SOURCE_EVIDENCE_FACTOR } from "./semantic-types.js";

export type TruncatedSourceEvidenceHintOptions = {
  status?: TaskStatus;
  consequence?: "high" | false;
  reason?: string;
};

export type TruncatedSourceEvidenceHints = {
  consequence?: "high";
  confidence: "low";
  factors: [typeof TRUNCATED_SOURCE_EVIDENCE_FACTOR];
  reasons?: string[];
};

export function semanticHintsForTruncatedSourceEvidence(
  options: TruncatedSourceEvidenceHintOptions = {},
): TruncatedSourceEvidenceHints {
  const consequence =
    options.consequence === "high" || (options.consequence !== false && options.status === "failed")
      ? "high"
      : undefined;
  return {
    ...(consequence === undefined ? {} : { consequence }),
    confidence: "low",
    factors: [TRUNCATED_SOURCE_EVIDENCE_FACTOR],
    reasons: [
      options.reason ??
        `source ${options.status === "failed" ? "failure " : ""}evidence was truncated before Aperture saw the full output`,
    ],
  };
}
