import type { NormalizedObservation } from "./normalized-observation.js";
import { readObservationExpectedSemanticRead } from "./observation-semantic-read.js";
import type { ObservationSemantics } from "./observation-semantics.js";
import { buildTaskFailureObservationInput } from "./semantic-evidence.js";
import type { AttentionOntologyDiagnostic } from "./semantic-ontology-types.js";
import type { SemanticInterpretation } from "./semantic-types.js";
import type { SourceEvent } from "./source-event.js";
import { projectTaskFailureObservationCore } from "./task-failure-observation-core.js";
import { enrichTaskFailureObservation } from "./task-failure-observation-normalizer.js";

type TaskFailureObservationEvent = Extract<SourceEvent, { type: "task.updated" }> & {
  semantic?: SemanticInterpretation;
};

export function projectTaskFailureObservationFromEvent(
  event: TaskFailureObservationEvent,
): ObservationSemantics | null {
  const failureEvidence = buildTaskFailureObservationInput(event);
  return failureEvidence !== null ? projectTaskFailureObservationCore(failureEvidence) : null;
}

export function normalizeTaskFailureObservationFromCore(input: {
  event: TaskFailureObservationEvent;
  core: ObservationSemantics;
  ontology: AttentionOntologyDiagnostic;
  abstained: boolean;
  interpretation: SemanticInterpretation | undefined;
}): NormalizedObservation {
  return enrichTaskFailureObservation({
    core: input.core,
    ontology: input.ontology,
    abstained: input.abstained,
    semanticAgreement: readTaskFailureObservationSemanticAgreement({
      event: input.event,
      observation: input.core,
      ontology: input.ontology,
      abstained: input.abstained,
      interpretation: input.interpretation ?? input.event.semantic,
    }),
  });
}

function readTaskFailureObservationSemanticAgreement(input: {
  event: TaskFailureObservationEvent;
  observation: ObservationSemantics;
  ontology: AttentionOntologyDiagnostic;
  abstained: boolean;
  interpretation: SemanticInterpretation | undefined;
}): NormalizedObservation["semanticAgreement"] {
  const semantic = input.interpretation;
  if (semantic === undefined || input.abstained) {
    return "uncertain";
  }

  if (input.event.evidence === undefined && hasFailureSemanticOverride(semantic.provenance)) {
    return "overridden";
  }

  return observationAgreesWithSemanticRead(input.observation, semantic, input.ontology)
    ? "stable"
    : "uncertain";
}

function hasFailureSemanticOverride(
  provenance: SemanticInterpretation["provenance"] | undefined,
): boolean {
  return (["intentFrame", "activityClass", "consequence"] as const).some(
    (field) => provenance?.[field] === "hint" || provenance?.[field] === "source",
  );
}

function observationAgreesWithSemanticRead(
  observation: ObservationSemantics,
  semantic: SemanticInterpretation,
  ontology: AttentionOntologyDiagnostic,
): boolean {
  const expected = readObservationExpectedSemanticRead(observation);

  return (
    ontology.ask === "status" &&
    ontology.activity === expected.activity &&
    ontology.blocking === "non_blocking" &&
    semantic.intentFrame === expected.intentFrame &&
    semantic.activityClass === expected.activityClass &&
    semantic.consequence === observation.consequenceBaseline &&
    ontology.consequence === observation.consequenceBaseline
  );
}
