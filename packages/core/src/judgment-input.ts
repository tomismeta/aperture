import type { ApertureEvent } from "./events.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { judgeObservation, type ObservationJudgment } from "./judgment-observation-contract.js";
import { buildObservationStatusConflictEvidenceFromCore } from "./judgment-observation-status-conflict.js";
import { projectAttentionOntologyDiagnosticWithStatusConflictEvidence } from "./attention-ontology-projector.js";
import type { SemanticConfidence } from "./semantic-types.js";
import type {
  AttentionJudgmentInput,
  CandidateSemanticEvidence,
  ObservationalStatusConflictEvidence,
  SemanticEvidenceStrength,
} from "./judgment-input-types.js";
import {
  normalizeTaskFailureObservationFromCore,
  projectTaskFailureObservationFromEvent,
} from "./task-failure-observation-reader.js";
import type {
  AttentionOntologyAuthority,
  AttentionOntologyDiagnostic,
} from "./semantic-ontology-types.js";

export type {
  AttentionJudgmentInput,
  Observation,
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
  const failureObservationCore =
    event.type === "task.updated" && event.status === "failed"
      ? projectTaskFailureObservationFromEvent(event)
      : null;
  const observationalStatusConflict = buildObservationStatusConflictEvidenceFromCore({
    event,
    core: failureObservationCore,
    interpretation: event.semantic,
    abstained,
  });
  const ontology = projectAttentionOntologyDiagnosticWithStatusConflictEvidence(
    event,
    event.semantic,
    observationalStatusConflict,
  );
  const blockedLikeStatus =
    event.type === "task.updated" && ontology.blocking === "blocking" && event.status !== "blocked";
  const observation =
    event.type === "task.updated" && event.status === "failed" && failureObservationCore !== null
      ? normalizeTaskFailureObservationFromCore({
          event,
          core: failureObservationCore,
          ontology,
          abstained,
          interpretation: event.semantic,
        })
      : null;

  return {
    ontology,
    semanticEvidence: {
      confidence: ontology.confidence,
      source: ontology.source,
      strength: deriveCompiledSemanticEvidenceStrength({
        ontology,
        observation,
        blockedLikeStatus,
        abstained,
      }),
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
    ...(observation !== null ? { observation } : {}),
    blockedLikeStatus,
    ...(observationalStatusConflict !== null ? { observationalStatusConflict } : {}),
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

export function readCandidateObservation(
  candidate: AttentionCandidate,
): NonNullable<AttentionJudgmentInput["observation"]> | null {
  return candidate.judgmentInput.observation ?? null;
}

export function readCandidateObservationJudgment(
  candidate: AttentionCandidate,
): ObservationJudgment | null {
  return readJudgmentInputObservationContract(candidate.judgmentInput);
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

export function hasObservationalStatusConflictSemantics(candidate: AttentionCandidate): boolean {
  return hasObservationalStatusConflictJudgmentInput(candidate.judgmentInput);
}

export function hasOutcomeOnlyFailureStatusJudgmentInput(
  judgmentInput: AttentionJudgmentInput,
): boolean {
  return readJudgmentInputObservationContract(judgmentInput)?.outcomeOnlyFailureStatus === true;
}

export function hasLimitedFailureStatusJudgmentInput(
  judgmentInput: AttentionJudgmentInput,
): boolean {
  return readJudgmentInputObservationContract(judgmentInput)?.limitedFailureStatus === true;
}

export function hasObservationalStatusConflictJudgmentInput(
  judgmentInput: AttentionJudgmentInput,
): boolean {
  return judgmentInput.observationalStatusConflict !== undefined;
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

function deriveCompiledSemanticEvidenceStrength(input: {
  ontology: AttentionOntologyDiagnostic;
  observation: NonNullable<AttentionJudgmentInput["observation"]> | null;
  blockedLikeStatus: boolean;
  abstained: boolean;
}): SemanticEvidenceStrength {
  const observationContract =
    input.observation !== null ? judgeObservation(input.observation) : null;
  if (
    observationContract !== null &&
    observationContract.statusEvidence === "limited_failure" &&
    observationContract.recoveryPosture === "evidence_required" &&
    observationContract.baselineConsequence === "medium" &&
    input.ontology.consequence === observationContract.baselineConsequence &&
    !input.blockedLikeStatus
  ) {
    return "weak";
  }

  return readSemanticEvidenceStrengthFromParts(
    input.ontology.confidence,
    input.ontology.source,
    input.abstained,
  );
}

function readJudgmentInputObservationContract(
  judgmentInput: AttentionJudgmentInput,
): ObservationJudgment | null {
  return judgmentInput.observation !== undefined
    ? judgeObservation(judgmentInput.observation)
    : null;
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
