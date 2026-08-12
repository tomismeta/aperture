import type { ApertureEvent } from "./events.js";
import type { ObservationalStatusConflictEvidence } from "./observational-status-conflict.js";
import type {
  AttentionOntologyActivity,
  AttentionOntologyAsk,
  AttentionOntologyAuthority,
  AttentionOntologyBlocking,
  AttentionOntologyDiagnostic,
  AttentionOntologyEpisode,
} from "./semantic-ontology-types.js";
import type { SemanticInterpretation, SemanticRelationHint } from "./semantic-types.js";
import type { SourceEvent } from "./source-event.js";

type OntologyEvent = SourceEvent | ApertureEvent;

export function projectAttentionOntologyDiagnostic(
  event: OntologyEvent,
  interpretation: SemanticInterpretation,
): AttentionOntologyDiagnostic {
  return projectAttentionOntologyDiagnosticWithStatusConflictEvidence(event, interpretation, null);
}

export function projectAttentionOntologyDiagnosticWithStatusConflictEvidence(
  event: OntologyEvent,
  interpretation: SemanticInterpretation,
  observationalStatusConflict: ObservationalStatusConflictEvidence | null,
): AttentionOntologyDiagnostic {
  return {
    ask: readOntologyAsk(event, interpretation),
    activity: readOntologyActivity(event, interpretation, observationalStatusConflict),
    ...(interpretation.consequence !== undefined
      ? { consequence: interpretation.consequence }
      : {}),
    blocking: readOntologyBlocking(event, interpretation),
    episode: readOntologyEpisode(event, interpretation),
    confidence: interpretation.confidence,
    source: readOntologySource(event, interpretation, observationalStatusConflict),
  };
}

function readOntologyAsk(
  event: OntologyEvent,
  interpretation: SemanticInterpretation,
): AttentionOntologyAsk {
  switch (event.type) {
    case "human.input.requested":
      return event.request.kind;
    case "task.started":
    case "task.completed":
    case "task.cancelled":
      return "none";
    case "task.updated":
      if (
        interpretation.intentFrame === "approval_request" ||
        interpretation.activityClass === "permission_request"
      ) {
        return "approval";
      }
      if (interpretation.intentFrame === "form_request") {
        return "form";
      }
      if (
        interpretation.intentFrame === "question_request" ||
        interpretation.activityClass === "question_request"
      ) {
        return "choice";
      }
      return "status";
    default:
      return unreachableOntologyEvent(event);
  }
}

function readOntologyActivity(
  event: OntologyEvent,
  interpretation: SemanticInterpretation,
  observationalStatusConflict: ObservationalStatusConflictEvidence | null,
): AttentionOntologyActivity {
  switch (event.type) {
    case "human.input.requested":
      return event.request.kind === "approval" ? "decision_request" : "question";
    case "task.completed":
    case "task.cancelled":
      return "task_completion";
    case "task.updated":
      if (
        interpretation.intentFrame === "approval_request" ||
        interpretation.activityClass === "permission_request"
      ) {
        return "decision_request";
      }
      if (
        interpretation.intentFrame === "question_request" ||
        interpretation.intentFrame === "form_request" ||
        interpretation.activityClass === "question_request"
      ) {
        return "question";
      }
      if (observationalStatusConflict !== null) {
        return "task_progress";
      }
      if (event.status === "failed" || interpretation.intentFrame === "failure") {
        return "failure";
      }
      if (event.status === "completed") {
        return "task_completion";
      }
      return "task_progress";
    case "task.started":
      return "background_work";
    default:
      return unreachableOntologyEvent(event);
  }
}

function readOntologyBlocking(
  event: OntologyEvent,
  interpretation: SemanticInterpretation,
): AttentionOntologyBlocking {
  switch (event.type) {
    case "human.input.requested":
      return "blocking";
    case "task.started":
    case "task.completed":
    case "task.cancelled":
      return "non_blocking";
    case "task.updated":
      if (event.status === "blocked" || interpretation.intentFrame === "blocked_work") {
        return "blocking";
      }
      if (
        event.status === "waiting" ||
        interpretation.intentFrame === "approval_request" ||
        interpretation.intentFrame === "question_request" ||
        interpretation.intentFrame === "form_request"
      ) {
        return "waiting";
      }
      return "non_blocking";
    default:
      return unreachableOntologyEvent(event);
  }
}

function readOntologyEpisode(
  event: OntologyEvent,
  interpretation: SemanticInterpretation,
): AttentionOntologyEpisode {
  const relationKinds = new Set(interpretation.relationHints.map((hint) => hint.kind));

  if (relationKinds.has("resolves")) {
    return "resolved";
  }

  if (relationKinds.has("same_issue") && hasResurfacingRelation(interpretation.relationHints)) {
    return "resurfaced";
  }

  if (relationKinds.has("same_issue")) {
    return "same_issue";
  }

  if (event.type === "human.input.requested" || event.type === "task.started") {
    return "new";
  }

  return "unknown";
}

function hasResurfacingRelation(relationHints: SemanticRelationHint[]): boolean {
  return relationHints.some(
    (hint) => hint.kind === "repeats" || hint.kind === "escalates" || hint.kind === "supersedes",
  );
}

function readOntologySource(
  event: OntologyEvent,
  interpretation: SemanticInterpretation,
  observationalStatusConflict: ObservationalStatusConflictEvidence | null,
): AttentionOntologyAuthority {
  const provenanceKinds = Object.values(interpretation.provenance ?? {});

  if (event.type === "task.updated" && event.evidence !== undefined) {
    return "explicit";
  }

  if (hasOntologyAuthorityHint(interpretation)) {
    return "hinted";
  }

  if (observationalStatusConflict !== null) {
    return "inferred";
  }

  if (isExplicitEventShapedSemanticRead(event, interpretation)) {
    if (
      event.type === "task.updated" &&
      interpretation.intentFrame === "status_update" &&
      interpretation.confidence === "low" &&
      interpretation.provenance?.confidence === "inferred"
    ) {
      return "inferred";
    }

    return "explicit";
  }

  if (provenanceKinds.includes("source")) {
    return "explicit";
  }

  if (provenanceKinds.includes("inferred")) {
    return "inferred";
  }

  return "explicit";
}

function hasOntologyAuthorityHint(interpretation: SemanticInterpretation): boolean {
  const provenance = interpretation.provenance ?? {};

  return (
    provenance.intentFrame === "hint" ||
    provenance.activityClass === "hint" ||
    provenance.consequence === "hint" ||
    provenance.relationHints === "hint" ||
    provenance.confidence === "hint" ||
    interpretation.relationHints.some((hint) => hint.target !== undefined)
  );
}

function isExplicitEventShapedSemanticRead(
  event: OntologyEvent,
  interpretation: SemanticInterpretation,
): boolean {
  switch (event.type) {
    case "human.input.requested":
      return true;
    case "task.started":
      return interpretation.intentFrame === "task_started";
    case "task.completed":
      return interpretation.intentFrame === "completion";
    case "task.cancelled":
      return interpretation.intentFrame === "cancellation";
    case "task.updated":
      return (
        (event.status === "failed" && interpretation.intentFrame === "failure") ||
        (event.status === "blocked" && interpretation.intentFrame === "blocked_work") ||
        (event.status === "waiting" && interpretation.intentFrame === "status_update") ||
        (event.status === "completed" && interpretation.intentFrame === "completion") ||
        (event.status === "running" && interpretation.intentFrame === "status_update")
      );
  }
}

function unreachableOntologyEvent(event: never): never {
  throw new Error(`Unsupported event type: ${(event as { type?: string }).type ?? "unknown"}`);
}
