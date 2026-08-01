import type { ObservationSemantics } from "./observation-semantics.js";
import type { TaskFailureSemanticEvidence } from "./semantic-evidence.js";
import { readTaskFailureEvidenceObservationSemantics } from "./task-failure-evidence-observation-grammar.js";

export function readTaskFailureObservationCore(
  evidence: TaskFailureSemanticEvidence,
): ObservationSemantics {
  return evidence.observationSemantics ?? readTaskFailureEvidenceObservationSemantics(evidence);
}
