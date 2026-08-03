export type ObservationKind = "control" | "diagnostic" | "outcome" | "payload" | "unknown";
export type ObservationPolarity = "failure" | "neutral" | "success" | "unknown";
export type ObservationOwner = "engine" | "source" | "tool" | "unknown";
export type ObservationSubject = "command" | "document" | "search" | "source" | "tool" | "unknown";
export type ObservationEvidenceLoss = "absent" | "none" | "partial" | "unknown";
export type ObservationDiagnosticClass = "expected" | "runtime" | "source_limit";
export type ObservationRecoveryHint =
  | "await_authorization"
  | "inspect_diagnostic"
  | "inspect_original_evidence"
  | "narrow_evidence_scope"
  | "request_evidence";
export type ObservationOrigin =
  | "command_output"
  | "read_output"
  | "semantic_evidence"
  | "status_text"
  | "structured_output"
  | "transcript";
export type ObservationEvidenceCertainty = "determinate" | "indeterminate";

export type ObservationSemantics = {
  kind: ObservationKind;
  polarity: ObservationPolarity;
  ownership: { owner: ObservationOwner; toolFamily?: string };
  subject: ObservationSubject;
  evidenceLoss: ObservationEvidenceLoss;
  diagnosticClass?: ObservationDiagnosticClass;
  recoveryHint?: ObservationRecoveryHint;
  provenance: { origin: ObservationOrigin };
  consequenceBaseline: "low" | "medium" | "high";
  evidenceCertainty: ObservationEvidenceCertainty;
};
