import type { Observation } from "./normalized-observation.js";
import type { TaskFailureSemanticEvidence } from "./semantic-evidence.js";
import type {
  AttentionOntologyAuthority,
  AttentionOntologyDiagnostic,
} from "./semantic-ontology-types.js";
import type { ObservationSemantics } from "./observation-semantics.js";
import { projectTaskFailureObservationCore } from "./task-failure-observation-core.js";

type ObservationAuthority = Observation["provenance"]["authority"];
type ObservationEvidenceLoss = Observation["evidenceLoss"];
type ObservationOwner = Observation["ownership"]["owner"];
type ObservationEvidenceStrength = Observation["evidenceStrength"];
type ObservationSubject = Observation["subject"];
type ObservationSemanticAgreement = Observation["semanticAgreement"];

export { projectTaskFailureObservationCore };

export function createStableFailureOutcomeObservation(input: {
  authority?: ObservationAuthority;
  owner?: ObservationOwner;
  evidenceStrength?: ObservationEvidenceStrength;
  subject?: ObservationSubject;
  capabilityFamily?: string;
}): Observation {
  return {
    kind: "outcome",
    polarity: "failure",
    semanticAgreement: "stable",
    ownership: {
      owner: input.owner ?? "engine",
      ...(input.capabilityFamily !== undefined ? { capabilityFamily: input.capabilityFamily } : {}),
    },
    evidenceStrength: input.evidenceStrength ?? "strong",
    subject: input.subject ?? "unknown",
    evidenceLoss: "none",
    provenance: { origin: "semantic_evidence", authority: input.authority ?? "unknown" },
    consequenceBaseline: "medium",
  };
}

export function normalizeTaskFailureObservation(input: {
  failureEvidence: TaskFailureSemanticEvidence;
  ontology: AttentionOntologyDiagnostic;
  abstained: boolean;
  semanticAgreement: ObservationSemanticAgreement;
}): Observation {
  return enrichTaskFailureObservation({
    core: projectTaskFailureObservationCore(input.failureEvidence),
    ontology: input.ontology,
    abstained: input.abstained,
    semanticAgreement: input.semanticAgreement,
  });
}

export function enrichTaskFailureObservation(input: {
  core: ObservationSemantics;
  ontology: AttentionOntologyDiagnostic;
  abstained: boolean;
  semanticAgreement: ObservationSemanticAgreement;
}): Observation {
  const semanticAgreement =
    input.core.evidenceCertainty === "indeterminate" ? "uncertain" : input.semanticAgreement;
  return {
    kind: input.core.kind,
    polarity: input.core.polarity,
    semanticAgreement,
    ownership: { ...input.core.ownership },
    evidenceStrength: deriveObservationEvidenceStrength({
      ontology: input.ontology,
      abstained: input.abstained,
      semanticAgreement,
      evidenceLoss: input.core.evidenceLoss,
    }),
    subject: input.core.subject,
    evidenceLoss: input.core.evidenceLoss,
    ...(input.core.diagnosticClass !== undefined
      ? { diagnosticClass: input.core.diagnosticClass }
      : {}),
    ...(input.core.recoveryHint !== undefined ? { recoveryHint: input.core.recoveryHint } : {}),
    provenance: {
      origin: input.core.provenance.origin,
      authority: readObservationAuthority(input.ontology.source),
    },
    consequenceBaseline: input.core.consequenceBaseline,
  };
}

function readObservationAuthority(
  source: AttentionOntologyAuthority | undefined,
): ObservationAuthority {
  switch (source) {
    case "explicit":
    case "hinted":
    case "inferred":
      return source;
    default:
      return "unknown";
  }
}

function deriveObservationEvidenceStrength(input: {
  ontology: AttentionOntologyDiagnostic;
  abstained: boolean;
  semanticAgreement: ObservationSemanticAgreement;
  evidenceLoss: ObservationEvidenceLoss;
}): ObservationEvidenceStrength {
  if (
    input.abstained ||
    input.semanticAgreement !== "stable" ||
    input.ontology.confidence === "low" ||
    input.evidenceLoss === "absent" ||
    input.evidenceLoss === "unknown"
  ) {
    return "weak";
  }

  if (input.ontology.confidence === "medium") {
    return input.ontology.source === "inferred" ? "weak" : "qualified";
  }

  return input.ontology.source === "inferred" ? "qualified" : "strong";
}
