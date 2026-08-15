type ObservationSemanticAgreement = "stable" | "overridden" | "uncertain";
type ObservationEvidenceStrength = "weak" | "qualified" | "strong";
type ObservationAuthority = "explicit" | "hinted" | "inferred" | "unknown";
type ObservationKind = "control" | "diagnostic" | "outcome" | "payload" | "unknown";
type ObservationPolarity = "failure" | "neutral" | "success" | "unknown";
type ObservationOwner = "engine" | "source" | "tool" | "unknown";
type ObservationSubject = "command" | "document" | "search" | "source" | "tool" | "unknown";
type ObservationEvidenceLoss = "absent" | "none" | "partial" | "unknown";
type ObservationDiagnosticClass = "expected" | "runtime" | "source_limit";
type ObservationRecoveryHint =
  | "await_authorization"
  | "inspect_diagnostic"
  | "inspect_original_evidence"
  | "narrow_evidence_scope"
  | "request_evidence";
type ObservationOrigin =
  | "command_output"
  | "read_output"
  | "semantic_evidence"
  | "status_text"
  | "structured_output"
  | "transcript";

export type Observation = {
  kind: ObservationKind;
  polarity: ObservationPolarity;
  ownership: { owner: ObservationOwner; capabilityFamily?: string };
  subject: ObservationSubject;
  evidenceLoss: ObservationEvidenceLoss;
  semanticAgreement: ObservationSemanticAgreement;
  evidenceStrength: ObservationEvidenceStrength;
  diagnosticClass?: ObservationDiagnosticClass;
  recoveryHint?: ObservationRecoveryHint;
  provenance: { origin: ObservationOrigin; authority: ObservationAuthority };
  consequenceBaseline: "low" | "medium" | "high";
};
