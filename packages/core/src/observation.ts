export type AttentionObservationKind = "control" | "diagnostic" | "outcome" | "payload" | "unknown";
export type AttentionObservationPolarity = "failure" | "neutral" | "success" | "unknown";
export type AttentionObservationAgreement = "stable" | "overridden" | "uncertain";
export type AttentionObservationStrength = "weak" | "qualified" | "strong";
export type AttentionObservationOwner = "engine" | "source" | "tool" | "unknown";
export type AttentionObservationAuthority = "explicit" | "hinted" | "inferred" | "unknown";
export type AttentionObservationSubject =
  | "command"
  | "document"
  | "search"
  | "source"
  | "tool"
  | "unknown";
export type AttentionObservationEvidenceLoss = "absent" | "none" | "partial" | "unknown";
export type AttentionObservationDiagnosticClass = "expected" | "runtime" | "source_limit";
export type AttentionObservationRecoveryHint =
  | "await_authorization"
  | "inspect_diagnostic"
  | "inspect_original_evidence"
  | "narrow_evidence_scope"
  | "request_evidence";
export type AttentionObservationOrigin =
  | "command_output"
  | "read_output"
  | "semantic_evidence"
  | "status_text"
  | "structured_output"
  | "transcript";

export type AttentionObservationIR = {
  kind: AttentionObservationKind;
  polarity: AttentionObservationPolarity;
  agreement: AttentionObservationAgreement;
  ownership: {
    owner: AttentionObservationOwner;
    toolFamily?: string;
  };
  strength: AttentionObservationStrength;
  subject: AttentionObservationSubject;
  evidenceLoss: AttentionObservationEvidenceLoss;
  diagnosticClass?: AttentionObservationDiagnosticClass;
  recoveryHint?: AttentionObservationRecoveryHint;
  provenance: {
    origin: AttentionObservationOrigin;
    authority: AttentionObservationAuthority;
  };
  consequenceBaseline: "low" | "medium" | "high";
};

export function createStableFailureOutcomeObservation(input: {
  authority?: AttentionObservationAuthority;
  owner?: AttentionObservationOwner;
  strength?: AttentionObservationStrength;
  subject?: AttentionObservationSubject;
  toolFamily?: string;
}): AttentionObservationIR {
  return {
    kind: "outcome",
    polarity: "failure",
    agreement: "stable",
    ownership: {
      owner: input.owner ?? "engine",
      ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    },
    strength: input.strength ?? "strong",
    subject: input.subject ?? "unknown",
    evidenceLoss: "none",
    provenance: { origin: "semantic_evidence", authority: input.authority ?? "unknown" },
    consequenceBaseline: "medium",
  };
}
