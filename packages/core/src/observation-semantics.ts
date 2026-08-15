import type { Observation } from "./judgment-input-types.js";

type ObservationEvidenceCertainty = "determinate" | "indeterminate";

export type ObservationSemantics = Omit<
  Observation,
  "semanticAgreement" | "evidenceStrength" | "provenance"
> & {
  ownership: Observation["ownership"];
  provenance: Pick<Observation["provenance"], "origin">;
  evidenceCertainty: ObservationEvidenceCertainty;
};
