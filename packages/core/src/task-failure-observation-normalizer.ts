import type {
  NormalizedObservationAuthority,
  NormalizedObservationEvidenceLoss,
  NormalizedObservation,
  NormalizedObservationOwner,
  NormalizedObservationEvidenceStrength,
  NormalizedObservationSubject,
  NormalizedObservationSemanticAgreement,
} from "./normalized-observation.js";
import type { TaskFailureSemanticEvidence } from "./semantic-evidence.js";
import type {
  AttentionOntologyAuthority,
  AttentionOntologyDiagnostic,
} from "./semantic-ontology-types.js";
import {
  readTaskFailureObservationCore,
  type TaskFailureObservationCore,
} from "./task-failure-observation-core.js";

export { readTaskFailureObservationCore, type TaskFailureObservationCore };

export function createStableFailureOutcomeObservation(input: {
  authority?: NormalizedObservationAuthority;
  owner?: NormalizedObservationOwner;
  evidenceStrength?: NormalizedObservationEvidenceStrength;
  subject?: NormalizedObservationSubject;
  toolFamily?: string;
}): NormalizedObservation {
  return {
    kind: "outcome",
    polarity: "failure",
    semanticAgreement: "stable",
    ownership: {
      owner: input.owner ?? "engine",
      ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
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
  semanticAgreement: NormalizedObservationSemanticAgreement;
}): NormalizedObservation {
  return enrichTaskFailureObservation({
    core: readTaskFailureObservationCore(input.failureEvidence),
    ontology: input.ontology,
    abstained: input.abstained,
    semanticAgreement: input.semanticAgreement,
  });
}

export function enrichTaskFailureObservation(input: {
  core: TaskFailureObservationCore;
  ontology: AttentionOntologyDiagnostic;
  abstained: boolean;
  semanticAgreement: NormalizedObservationSemanticAgreement;
}): NormalizedObservation {
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
): NormalizedObservationAuthority {
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
  semanticAgreement: NormalizedObservationSemanticAgreement;
  evidenceLoss: NormalizedObservationEvidenceLoss;
}): NormalizedObservationEvidenceStrength {
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
