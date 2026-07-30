import type { ApertureEvent } from "./events.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { readRoutineObservationalStatusConflictEvidence } from "./semantic-evidence.js";
import { projectAttentionOntologyDiagnosticWithStatusConflictEvidence } from "./semantic-ontology.js";
import type { SemanticConfidence } from "./semantic-types.js";
import type {
  AttentionJudgmentInput,
  CandidateSemanticEvidence,
  ObservationalStatusConflictEvidence,
  SemanticEvidenceStrength,
} from "./judgment-input-types.js";
import type {
  AttentionOntologyAuthority,
  AttentionOntologyDiagnostic,
} from "./semantic-ontology-types.js";

export type {
  AttentionJudgmentInput,
  CandidateSemanticEvidence,
  SemanticEvidenceStrength,
} from "./judgment-input-types.js";

/**
 * Single semantic-to-judgment seam for routed events.
 *
 * Every `AttentionCandidate` carries `judgmentInput`. It is intentionally
 * smaller than full semantics and gives policy, ambiguity handling, planning,
 * and trace one compiled place to read:
 *
 * `SemanticInterpretation`
 *   -> `AttentionOntologyDiagnostic`
 *      loses raw reasons/why-now/factors and keeps the compact 7-dimension read
 *   -> `AttentionJudgmentInput`
 *      narrows again to the routing-critical subset used by judgment
 *
 * - ontology
 * - semantic evidence strength from confidence + source
 * - blocked-like status diagnostics
 */
// `AttentionJudgmentInput` is defined in `judgment-input-types.ts` so the seam
// contract can be read without walking through the compilation logic here.

export function buildAttentionJudgmentInput(event: ApertureEvent): AttentionJudgmentInput {
  if (!event.semantic) {
    return {
      blockedLikeStatus: false,
    };
  }

  const abstained = event.semantic.abstained === true;
  const observationalStatusConflict = readRoutineObservationalStatusConflictEvidence(
    event,
    event.semantic,
    abstained,
  );
  const ontology = projectAttentionOntologyDiagnosticWithStatusConflictEvidence(
    event,
    event.semantic,
    observationalStatusConflict,
  );

  return {
    ontology,
    semanticEvidence: {
      confidence: ontology.confidence,
      source: ontology.source,
      strength: readSemanticEvidenceStrengthFromParts(
        ontology.confidence,
        ontology.source,
        abstained,
      ),
      abstained,
    },
    ...(event.semantic.relationHints.length > 0
      ? {
          relationEvidence: {
            source: readSemanticRelationEvidenceSource(event.semantic),
            strength: deriveSemanticRelationEvidenceStrength(event.semantic, abstained),
          },
        }
      : {}),
    blockedLikeStatus:
      event.type === "task.updated" &&
      ontology.blocking === "blocking" &&
      event.status !== "blocked",
    ...(observationalStatusConflict !== null
      ? {
          routineObservationalStatusConflict: true,
          observationalStatusConflict,
        }
      : {}),
  };
}

export function readSemanticEvidenceStrength(
  candidate: AttentionCandidate,
): SemanticEvidenceStrength | null {
  return readCandidateSemanticEvidence(candidate)?.strength ?? null;
}

export function readCandidateSemanticEvidence(
  candidate: AttentionCandidate,
): CandidateSemanticEvidence | null {
  return candidate.judgmentInput.semanticEvidence ?? null;
}

export function readCandidateSemanticRelationEvidence(
  candidate: AttentionCandidate,
): AttentionJudgmentInput["relationEvidence"] | null {
  return candidate.judgmentInput.relationEvidence ?? null;
}

export function readCandidateObservationalStatusConflictEvidence(
  candidate: AttentionCandidate,
): ObservationalStatusConflictEvidence | null {
  return candidate.judgmentInput.observationalStatusConflict ?? null;
}

export function readSemanticRelationEvidenceStrength(
  candidate: AttentionCandidate,
): SemanticEvidenceStrength | null {
  return readCandidateSemanticRelationEvidence(candidate)?.strength ?? null;
}

export function readCandidateAttentionOntology(
  candidate: AttentionCandidate,
): AttentionOntologyDiagnostic | null {
  return candidate.judgmentInput.ontology ?? null;
}

export function readCandidateSemanticOntology(
  candidate: AttentionCandidate,
): AttentionOntologyDiagnostic | null {
  return readCandidateAttentionOntology(candidate);
}

export function readCandidateSemanticConfidence(
  candidate: AttentionCandidate,
): SemanticConfidence | null {
  return readCandidateSemanticEvidence(candidate)?.confidence ?? null;
}

export function isCandidateSemanticAbstained(candidate: AttentionCandidate): boolean {
  return readCandidateSemanticEvidence(candidate)?.abstained === true;
}

export function isCandidateSemanticLowConfidence(candidate: AttentionCandidate): boolean {
  return readCandidateSemanticConfidence(candidate) === "low";
}

export function hasCandidateSemanticUncertainty(candidate: AttentionCandidate): boolean {
  return (
    isCandidateSemanticAbstained(candidate) ||
    isCandidateSemanticLowConfidence(candidate) ||
    readSemanticEvidenceStrength(candidate) === "weak"
  );
}

export function readSemanticSourceCriterionOffset(candidate: AttentionCandidate): number {
  const strength = readSemanticEvidenceStrength(candidate);
  const source = readCandidateSemanticEvidence(candidate)?.source;

  if (!strength || !source) {
    return 0;
  }

  if (source === "inferred") {
    switch (strength) {
      case "weak":
        return -2;
      case "qualified":
        return -1;
      case "strong":
        return 0;
    }
  }

  if ((source === "explicit" || source === "hinted") && strength === "strong") {
    return 1;
  }

  return 0;
}

export function hasBlockedLikeStatusSemantics(candidate: AttentionCandidate): boolean {
  return candidate.judgmentInput.blockedLikeStatus;
}

export function hasActionableBlockedLikeStatusSemantics(candidate: AttentionCandidate): boolean {
  return hasActionableBlockedLikeStatusJudgmentInput(candidate.judgmentInput);
}

export function hasActionableBlockedLikeStatusJudgmentInput(
  judgmentInput: AttentionJudgmentInput,
): boolean {
  if (!judgmentInput.blockedLikeStatus) {
    return false;
  }

  const evidence = judgmentInput.semanticEvidence;
  return evidence !== undefined && evidence.confidence !== "low" && !evidence.abstained;
}

export function hasRoutineObservationalStatusConflictSemantics(
  candidate: AttentionCandidate,
): boolean {
  return hasRoutineObservationalStatusConflictJudgmentInput(candidate.judgmentInput);
}

export function hasRoutineObservationalStatusConflictJudgmentInput(
  judgmentInput: AttentionJudgmentInput,
): boolean {
  return (
    judgmentInput.routineObservationalStatusConflict === true ||
    judgmentInput.observationalStatusConflict !== undefined
  );
}

export function resolvePeripheralResolutionFloor(
  candidate: AttentionCandidate,
  fallback: "queue" | "ambient",
): "queue" | "ambient" {
  if (fallback === "ambient" && hasBlockedLikeStatusSemantics(candidate)) {
    return "queue";
  }

  return fallback;
}

function readSemanticEvidenceStrengthFromParts(
  confidence: SemanticConfidence,
  source: AttentionOntologyAuthority | undefined,
  abstained: boolean,
): SemanticEvidenceStrength {
  if (abstained) {
    return "weak";
  }

  switch (confidence) {
    case "low":
      return "weak";
    case "medium":
      return source === "inferred" ? "weak" : "qualified";
    case "high":
      return source === "inferred" ? "qualified" : "strong";
  }
}

function readSemanticRelationEvidenceSource(
  interpretation: NonNullable<ApertureEvent["semantic"]>,
): AttentionOntologyAuthority {
  const provenance = interpretation.provenance?.relationHints;
  switch (provenance) {
    case "source":
      return "explicit";
    case "hint":
      return "hinted";
    case "inferred":
      return "inferred";
    default:
      return "inferred";
  }
}

function deriveSemanticRelationEvidenceStrength(
  interpretation: NonNullable<ApertureEvent["semantic"]>,
  abstained: boolean,
): SemanticEvidenceStrength {
  const source = readSemanticRelationEvidenceSource(interpretation);
  switch (source) {
    case "explicit":
      return "strong";
    case "hinted":
      return abstained ? "weak" : "qualified";
    case "inferred":
      return readSemanticEvidenceStrengthFromParts(
        interpretation.confidence,
        "inferred",
        abstained,
      );
  }
}
