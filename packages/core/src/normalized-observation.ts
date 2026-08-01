import type {
  ObservationDiagnosticClass,
  ObservationEvidenceLoss,
  ObservationKind,
  ObservationOrigin,
  ObservationOwner,
  ObservationPolarity,
  ObservationRecoveryHint,
  ObservationSemantics,
  ObservationSubject,
} from "./observation-semantics.js";

export type NormalizedObservationKind = ObservationKind;
export type NormalizedObservationPolarity = ObservationPolarity;
export type NormalizedObservationOwner = ObservationOwner;
export type NormalizedObservationSubject = ObservationSubject;
export type NormalizedObservationEvidenceLoss = ObservationEvidenceLoss;
export type NormalizedObservationDiagnosticClass = ObservationDiagnosticClass;
export type NormalizedObservationRecoveryHint = ObservationRecoveryHint;
export type NormalizedObservationOrigin = ObservationOrigin;

export type NormalizedObservationSemanticAgreement = "stable" | "overridden" | "uncertain";
export type NormalizedObservationEvidenceStrength = "weak" | "qualified" | "strong";
export type NormalizedObservationAuthority = "explicit" | "hinted" | "inferred" | "unknown";

export type NormalizedObservation = Omit<
  ObservationSemantics,
  "evidenceCertainty" | "provenance"
> & {
  semanticAgreement: NormalizedObservationSemanticAgreement;
  evidenceStrength: NormalizedObservationEvidenceStrength;
  provenance: ObservationSemantics["provenance"] & {
    authority: NormalizedObservationAuthority;
  };
};
