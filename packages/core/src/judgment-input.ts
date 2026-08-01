import type { ApertureEvent } from "./events.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import {
  readRoutineObservationalStatusConflictEvidence,
  readTaskFailureSemanticEvidence,
  type TaskFailureSemanticEvidence,
} from "./semantic-evidence.js";
import { projectAttentionOntologyDiagnosticWithStatusConflictEvidence } from "./semantic-ontology.js";
import type { SemanticConfidence } from "./semantic-types.js";
import type {
  AttentionJudgmentInput,
  CandidateSemanticEvidence,
  ObservationalStatusConflictEvidence,
  SemanticEvidenceStrength,
  TaskFailureSemanticAgreement,
} from "./judgment-input-types.js";
import { normalizeTaskFailureObservation } from "./task-failure-observation-normalizer.js";
import type { NormalizedObservation } from "./normalized-observation.js";
import type {
  AttentionOntologyAuthority,
  AttentionOntologyDiagnostic,
} from "./semantic-ontology-types.js";

export type {
  AttentionJudgmentInput,
  NormalizedObservation,
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
  const failureEvidence =
    event.type === "task.updated" && event.status === "failed"
      ? readTaskFailureSemanticEvidence(event)
      : null;
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
  const blockedLikeStatus =
    event.type === "task.updated" && ontology.blocking === "blocking" && event.status !== "blocked";
  const failureAgreement =
    failureEvidence !== null
      ? readTaskFailureSemanticAgreement({
          event,
          failureEvidence,
          ontology,
          abstained,
        })
      : null;
  const observation =
    failureEvidence !== null && failureAgreement !== null
      ? normalizeTaskFailureObservation({
          failureEvidence,
          ontology,
          abstained,
          semanticAgreement: failureAgreement,
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

export function readCandidateObservation(
  candidate: AttentionCandidate,
): NormalizedObservation | null {
  return candidate.judgmentInput.observation ?? null;
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

export function hasOutcomeOnlyFailureStatusSemantics(candidate: AttentionCandidate): boolean {
  return hasOutcomeOnlyFailureStatusJudgmentInput(candidate.judgmentInput);
}

export function hasLimitedFailureStatusSemantics(candidate: AttentionCandidate): boolean {
  return hasLimitedFailureStatusJudgmentInput(candidate.judgmentInput);
}

export function hasOutcomeOnlyFailureStatusJudgmentInput(
  judgmentInput: AttentionJudgmentInput,
): boolean {
  const observation = judgmentInput.observation;
  return (
    observation?.kind === "outcome" &&
    observation.polarity === "failure" &&
    observation.evidenceLoss === "none" &&
    observation.consequenceBaseline === "medium" &&
    observation.semanticAgreement === "stable"
  );
}

export function hasLimitedFailureStatusJudgmentInput(
  judgmentInput: AttentionJudgmentInput,
): boolean {
  const observation = judgmentInput.observation;
  return (
    hasOutcomeOnlyFailureStatusJudgmentInput(judgmentInput) ||
    (observation?.evidenceLoss === "absent" &&
      observation.recoveryHint === "request_evidence" &&
      observation.consequenceBaseline === "medium" &&
      observation.semanticAgreement === "stable") ||
    (observation?.evidenceLoss === "partial" &&
      observation.recoveryHint === "narrow_evidence_scope" &&
      observation.consequenceBaseline === "medium" &&
      observation.semanticAgreement === "stable")
  );
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

function deriveCompiledSemanticEvidenceStrength(input: {
  ontology: AttentionOntologyDiagnostic;
  observation: NormalizedObservation | null;
  blockedLikeStatus: boolean;
  abstained: boolean;
}): SemanticEvidenceStrength {
  if (
    input.observation?.kind === "outcome" &&
    input.observation.evidenceLoss === "absent" &&
    input.observation.consequenceBaseline === "medium" &&
    input.ontology.consequence === "medium" &&
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

function readTaskFailureSemanticAgreement(input: {
  event: ApertureEvent;
  failureEvidence: TaskFailureSemanticEvidence;
  ontology: AttentionOntologyDiagnostic;
  abstained: boolean;
}): TaskFailureSemanticAgreement {
  const semantic = input.event.semantic;
  if (
    semantic === undefined ||
    input.abstained ||
    semantic.confidence === "low" ||
    input.ontology.confidence === "low" ||
    (input.failureEvidence.kind === "terminal_failure" &&
      input.failureEvidence.failureDetail === "indeterminate")
  ) {
    return "uncertain";
  }

  if (hasFailureSemanticOverride(semantic.provenance)) {
    return "overridden";
  }

  return failureEvidenceAgreesWithSemanticRead(input.failureEvidence, semantic, input.ontology)
    ? "stable"
    : "uncertain";
}

function hasFailureSemanticOverride(
  provenance: NonNullable<ApertureEvent["semantic"]>["provenance"] | undefined,
): boolean {
  return (
    provenance?.intentFrame === "hint" ||
    provenance?.intentFrame === "source" ||
    provenance?.activityClass === "hint" ||
    provenance?.activityClass === "source" ||
    provenance?.consequence === "hint" ||
    provenance?.consequence === "source"
  );
}

function failureEvidenceAgreesWithSemanticRead(
  failureEvidence: TaskFailureSemanticEvidence,
  semantic: NonNullable<ApertureEvent["semantic"]>,
  ontology: AttentionOntologyDiagnostic,
): boolean {
  const expectedActivity = failureEvidence.readsAsObservation ? "task_progress" : "failure";
  const expectedIntentFrame = failureEvidence.readsAsObservation ? "status_update" : "failure";
  const expectedActivityClass = failureEvidence.readsAsObservation
    ? "status_update"
    : "tool_failure";

  return (
    ontology.ask === "status" &&
    ontology.activity === expectedActivity &&
    ontology.blocking === "non_blocking" &&
    semantic.intentFrame === expectedIntentFrame &&
    semantic.activityClass === expectedActivityClass &&
    semantic.consequence === failureEvidence.consequenceBaseline &&
    ontology.consequence === failureEvidence.consequenceBaseline
  );
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
