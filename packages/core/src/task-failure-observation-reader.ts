import type { NormalizedObservation } from "./normalized-observation.js";
import type { ObservationalStatusConflictEvidence } from "./observational-status-conflict.js";
import { readObservationalStatusConflictEvidenceFromObservation } from "./observational-status-conflict-kind.js";
import { readObservationExpectedSemanticRead } from "./observation-semantic-read.js";
import type { ObservationSemantics } from "./observation-semantics.js";
import { readTaskFailureSemanticEvidence } from "./semantic-evidence.js";
import type { AttentionOntologyDiagnostic } from "./semantic-ontology-types.js";
import type { SemanticInterpretation } from "./semantic-types.js";
import { readTaskFailureObservationCore } from "./task-failure-observation-core.js";
import { enrichTaskFailureObservation } from "./task-failure-observation-normalizer.js";

type TaskFailureObservationEvent = Record<string, unknown> & {
  type: string;
  status?: string;
  title?: string;
  summary?: string;
  toolFamily?: string;
  context?: {
    items?: Array<{ id: string; label: string; value?: string }>;
  };
  semantic?: SemanticInterpretation;
};

export function readTaskFailureObservationCoreFromEvent(
  event: TaskFailureObservationEvent,
): ObservationSemantics | null {
  const failureEvidence = readTaskFailureSemanticEvidence(event);
  return failureEvidence !== null ? readTaskFailureObservationCore(failureEvidence) : null;
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

export function readRoutineObservationalStatusConflictEvidenceFromEvent(
  event: TaskFailureObservationEvent,
  interpretation: SemanticInterpretation,
  abstained = interpretation.abstained === true,
): ObservationalStatusConflictEvidence | null {
  const core = readTaskFailureObservationCoreFromEvent(event);
  if (core === null) {
    return null;
  }

  const expected = readObservationExpectedSemanticRead(core);

  return readObservationalStatusConflictEvidenceFromObservation({
    event,
    interpretation,
    abstained,
    observation: enrichTaskFailureObservation({
      core,
      ontology: {
        ask: "status",
        activity: expected.activity,
        ...(interpretation.consequence !== undefined
          ? { consequence: interpretation.consequence }
          : {}),
        blocking: "non_blocking",
        episode: "unknown",
        confidence: interpretation.confidence,
        source: "inferred",
      },
      abstained,
      semanticAgreement: "stable",
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
  if (
    semantic === undefined ||
    input.abstained ||
    semantic.confidence === "low" ||
    input.ontology.confidence === "low"
  ) {
    return "uncertain";
  }

  if (hasFailureSemanticOverride(semantic.provenance)) {
    return "overridden";
  }

  return observationAgreesWithSemanticRead(input.observation, semantic, input.ontology)
    ? "stable"
    : "uncertain";
}

function hasFailureSemanticOverride(
  provenance: SemanticInterpretation["provenance"] | undefined,
): boolean {
  return (
    provenance?.intentFrame === "hint" ||
    provenance?.intentFrame === "source" ||
    provenance?.activityClass === "hint" ||
    provenance?.activityClass === "source" ||
    provenance?.consequence === "hint" ||
    provenance?.consequence === "source"
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
