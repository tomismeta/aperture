import { resolveObservationStatusConflictKindFromShape } from "./judgment-observation-contract.js";
import type { ObservationalStatusConflictEvidence } from "./observational-status-conflict.js";
import type { ObservationSemantics } from "./observation-semantics.js";
import { TRUNCATED_SOURCE_EVIDENCE_FACTOR } from "./semantic-source-quality.js";
import type { SemanticInterpretation } from "./semantic-types.js";

type ObservationStatusConflictEvent = {
  type: string;
  status?: string;
};

export function buildObservationStatusConflictEvidenceFromCore(input: {
  event: ObservationStatusConflictEvent;
  core: ObservationSemantics | null;
  interpretation: SemanticInterpretation;
  abstained: boolean;
}): ObservationalStatusConflictEvidence | null {
  const core = input.core;
  if (
    input.event.type !== "task.updated" ||
    input.event.status !== "failed" ||
    core === null ||
    input.interpretation.intentFrame !== "status_update" ||
    input.interpretation.activityClass !== "status_update" ||
    core.ownership.toolFamily !== input.interpretation.toolFamily ||
    input.interpretation.consequence !== core.consequenceBaseline ||
    !hasStableObservationStatusConflictConfidence(input.interpretation) ||
    input.abstained
  ) {
    return null;
  }

  const kind = resolveObservationStatusConflictKindFromShape(core);
  return kind === null
    ? null
    : {
        kind,
        ...(core.ownership.toolFamily !== undefined
          ? { toolFamily: core.ownership.toolFamily }
          : {}),
        baselineConsequence: core.consequenceBaseline,
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
