import type { ObservationJudgmentDocument } from "./judgment-observation-contract.js";
import { projectObservationJudgmentContract } from "./judgment-observation-contract.js";
import type { ObservationalStatusConflictEvidence } from "./observational-status-conflict.js";
import { TRUNCATED_SOURCE_EVIDENCE_FACTOR } from "./semantic-source-quality.js";
import type { SemanticInterpretation } from "./semantic-types.js";

type ObservationStatusConflictEvent = {
  type: string;
  status?: string;
};

export function buildObservationStatusConflictEvidence(input: {
  event: ObservationStatusConflictEvent;
  observation: ObservationJudgmentDocument | null;
  interpretation: SemanticInterpretation;
  abstained: boolean;
}): ObservationalStatusConflictEvidence | null {
  const observation = input.observation;
  const contract = observation !== null ? projectObservationJudgmentContract(observation) : null;
  if (
    input.event.type !== "task.updated" ||
    input.event.status !== "failed" ||
    observation === null ||
    contract === null ||
    input.interpretation.intentFrame !== "status_update" ||
    input.interpretation.activityClass !== "status_update" ||
    observation.ownership.toolFamily !== input.interpretation.toolFamily ||
    input.interpretation.consequence !== contract.baselineConsequence ||
    !hasStableObservationStatusConflictConfidence(input.interpretation) ||
    input.abstained
  ) {
    return null;
  }

  const kind = contract.statusConflictKind;
  return kind === null
    ? null
    : {
        kind,
        ...(observation.ownership.toolFamily !== undefined
          ? { toolFamily: observation.ownership.toolFamily }
          : {}),
        baselineConsequence: contract.baselineConsequence,
      };
}

function hasStableObservationStatusConflictConfidence(
  interpretation: SemanticInterpretation,
): boolean {
  return (
    interpretation.confidence === "high" ||
    (interpretation.confidence === "low" &&
      interpretation.factors.includes(TRUNCATED_SOURCE_EVIDENCE_FACTOR))
  );
}
