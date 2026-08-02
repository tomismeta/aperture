import type { ObservationSemantics } from "./observation-semantics.js";
export type {
  ObservationDiagnosticClass as NormalizedObservationDiagnosticClass,
  ObservationEvidenceLoss as NormalizedObservationEvidenceLoss,
  ObservationKind as NormalizedObservationKind,
  ObservationOrigin as NormalizedObservationOrigin,
  ObservationOwner as NormalizedObservationOwner,
  ObservationPolarity as NormalizedObservationPolarity,
  ObservationRecoveryHint as NormalizedObservationRecoveryHint,
  ObservationSubject as NormalizedObservationSubject,
} from "./observation-semantics.js";

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
