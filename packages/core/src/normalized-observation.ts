export type NormalizedObservationKind =
  | "control"
  | "diagnostic"
  | "outcome"
  | "payload"
  | "unknown";
export type NormalizedObservationPolarity = "failure" | "neutral" | "success" | "unknown";
export type NormalizedObservationSemanticAgreement = "stable" | "overridden" | "uncertain";
export type NormalizedObservationEvidenceStrength = "weak" | "qualified" | "strong";
export type NormalizedObservationOwner = "engine" | "source" | "tool" | "unknown";
export type NormalizedObservationAuthority = "explicit" | "hinted" | "inferred" | "unknown";
export type NormalizedObservationSubject =
  | "command"
  | "document"
  | "search"
  | "source"
  | "tool"
  | "unknown";
export type NormalizedObservationEvidenceLoss = "absent" | "none" | "partial" | "unknown";
export type NormalizedObservationDiagnosticClass = "expected" | "runtime" | "source_limit";
export type NormalizedObservationRecoveryHint =
  | "await_authorization"
  | "inspect_diagnostic"
  | "inspect_original_evidence"
  | "narrow_evidence_scope"
  | "request_evidence";
export type NormalizedObservationOrigin =
  | "command_output"
  | "read_output"
  | "semantic_evidence"
  | "status_text"
  | "structured_output"
  | "transcript";

export type NormalizedObservation = {
  kind: NormalizedObservationKind;
  polarity: NormalizedObservationPolarity;
  semanticAgreement: NormalizedObservationSemanticAgreement;
  ownership: {
    owner: NormalizedObservationOwner;
    toolFamily?: string;
  };
  evidenceStrength: NormalizedObservationEvidenceStrength;
  subject: NormalizedObservationSubject;
  evidenceLoss: NormalizedObservationEvidenceLoss;
  diagnosticClass?: NormalizedObservationDiagnosticClass;
  recoveryHint?: NormalizedObservationRecoveryHint;
  provenance: {
    origin: NormalizedObservationOrigin;
    authority: NormalizedObservationAuthority;
  };
  consequenceBaseline: "low" | "medium" | "high";
};
