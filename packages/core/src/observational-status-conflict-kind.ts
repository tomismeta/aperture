import type { TaskFailureEvidenceKind } from "./semantic-evidence.js";
import type { NormalizedObservation } from "./normalized-observation.js";
import type {
  ObservationalStatusConflictEvidence,
  ObservationalStatusConflictKind,
} from "./observational-status-conflict.js";
import type { SemanticInterpretation } from "./semantic-types.js";
import { TRUNCATED_SOURCE_EVIDENCE_FACTOR } from "./semantic-source-quality.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";

export function readObservationalStatusConflictKind(
  kind: TaskFailureEvidenceKind,
): ObservationalStatusConflictKind | null {
  switch (kind) {
    case "routine_bash_success_observation":
      return "command_success_observation";
    case "structured_execution_success_observation":
      return "execution_success_observation";
    case "operation_success_observation":
    case "observational_payload":
      return "payload_observation";
    case "structured_tool_output_observation":
      return "structured_output_observation";
    case "routine_search_output":
      return "search_output_observation";
    case "rejected_tool_use_observation":
      return "rejected_tool_use_observation";
    case "empty_failure_payload":
    case "expected_diagnostic_failure":
    case "terminal_failure":
    case "unclassified_failure":
      return null;
  }
}

export function readObservationalStatusConflictKindFromObservation(
  observation: NormalizedObservation,
): ObservationalStatusConflictKind | null {
  switch (observation.kind) {
    case "control":
      return observation.recoveryHint === "await_authorization"
        ? "rejected_tool_use_observation"
        : null;
    case "outcome":
      if (observation.polarity !== "success") {
        return null;
      }
      if (observation.provenance.origin === "structured_output") {
        return "execution_success_observation";
      }
      return isSemanticCommandExecutionToolFamily(observation.ownership.toolFamily)
        ? "command_success_observation"
        : "payload_observation";
    case "payload":
      if (observation.provenance.origin === "structured_output") {
        return "structured_output_observation";
      }
      return observation.subject === "search" || observation.ownership.toolFamily === "search"
        ? "search_output_observation"
        : "payload_observation";
    case "diagnostic":
    case "unknown":
      return null;
  }
}

export function readObservationalStatusConflictEvidenceFromObservation(input: {
  event: { type: string; status?: string };
  observation: NormalizedObservation | null;
  interpretation: SemanticInterpretation;
  abstained: boolean;
}): ObservationalStatusConflictEvidence | null {
  const observation = input.observation;

  if (
    input.event.type !== "task.updated" ||
    input.event.status !== "failed" ||
    observation === null ||
    input.interpretation.intentFrame !== "status_update" ||
    input.interpretation.activityClass !== "status_update" ||
    observation.ownership.toolFamily !== input.interpretation.toolFamily ||
    input.interpretation.consequence !== observation.consequenceBaseline ||
    !hasStableObservationalStatusConflictConfidence(input.interpretation) ||
    input.abstained
  ) {
    return null;
  }

  const kind = readObservationalStatusConflictKindFromObservation(observation);
  if (kind === null) {
    return null;
  }

  return {
    kind,
    ...(observation.ownership.toolFamily !== undefined
      ? { toolFamily: observation.ownership.toolFamily }
      : {}),
    baselineConsequence: observation.consequenceBaseline,
  };
}

function hasStableObservationalStatusConflictConfidence(
  interpretation: SemanticInterpretation,
): boolean {
  return (
    interpretation.confidence === "high" ||
    (interpretation.confidence === "low" &&
      interpretation.factors.includes(TRUNCATED_SOURCE_EVIDENCE_FACTOR))
  );
}
