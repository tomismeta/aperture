import type { ApertureEvent } from "./events.js";
import type { SourceEvent } from "./source-event.js";
import { interpretSourceEvent } from "./semantic-interpreter.js";
import type {
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticInterpretation,
  SemanticRelationHint,
} from "./semantic-types.js";

export type SemanticOntologyAsk =
  | "approval"
  | "choice"
  | "form"
  | "status"
  | "none";

export type SemanticOntologyActivity =
  | "decision_request"
  | "question"
  | "task_progress"
  | "task_completion"
  | "failure"
  | "background_work";

export type SemanticOntologyBlocking =
  | "blocking"
  | "waiting"
  | "non_blocking";

export type SemanticOntologyEpisode =
  | "new"
  | "same_issue"
  | "resurfaced"
  | "resolved"
  | "unknown";

export type SemanticOntologySource =
  | "explicit"
  | "hinted"
  | "inferred";

export type SemanticOntologyDiagnostic = {
  ask: SemanticOntologyAsk;
  activity: SemanticOntologyActivity;
  consequence?: SemanticConsequenceLevel;
  blocking: SemanticOntologyBlocking;
  episode: SemanticOntologyEpisode;
  confidence: SemanticConfidence;
  source: SemanticOntologySource;
};

type SemanticOntologyEvent = SourceEvent | ApertureEvent;

export function readSemanticOntologyDiagnostic(
  event: SourceEvent,
  interpretation = interpretSourceEvent(event),
): SemanticOntologyDiagnostic {
  return projectSemanticOntologyDiagnostic(event, interpretation);
}

export function projectSemanticOntologyDiagnostic(
  event: SemanticOntologyEvent,
  interpretation: SemanticInterpretation,
): SemanticOntologyDiagnostic {
  return {
    ask: readOntologyAsk(event, interpretation),
    activity: readOntologyActivity(event, interpretation),
    ...(interpretation.consequence !== undefined
      ? { consequence: interpretation.consequence }
      : {}),
    blocking: readOntologyBlocking(event, interpretation),
    episode: readOntologyEpisode(event, interpretation),
    confidence: interpretation.confidence,
    source: readOntologySource(interpretation),
  };
}

function readOntologyAsk(
  event: SemanticOntologyEvent,
  interpretation: SemanticInterpretation,
): SemanticOntologyAsk {
  switch (event.type) {
    case "human.input.requested":
      return event.request.kind;
    case "task.updated":
      if (
        interpretation.intentFrame === "approval_request"
        || interpretation.activityClass === "permission_request"
      ) {
        return "approval";
      }
      if (interpretation.intentFrame === "form_request") {
        return "form";
      }
      if (
        interpretation.intentFrame === "question_request"
        || interpretation.activityClass === "question_request"
      ) {
        return "choice";
      }
      return "status";
    default:
      return "none";
  }
}

function readOntologyActivity(
  event: SemanticOntologyEvent,
  interpretation: SemanticInterpretation,
): SemanticOntologyActivity {
  switch (event.type) {
    case "human.input.requested":
      return event.request.kind === "approval"
        ? "decision_request"
        : "question";
    case "task.completed":
    case "task.cancelled":
      return "task_completion";
    case "task.updated":
      if (
        interpretation.intentFrame === "approval_request"
        || interpretation.activityClass === "permission_request"
      ) {
        return "decision_request";
      }
      if (
        interpretation.intentFrame === "question_request"
        || interpretation.intentFrame === "form_request"
        || interpretation.activityClass === "question_request"
      ) {
        return "question";
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
  }
}

function readOntologyBlocking(
  event: SemanticOntologyEvent,
  interpretation: SemanticInterpretation,
): SemanticOntologyBlocking {
  switch (event.type) {
    case "human.input.requested":
      return "blocking";
    case "task.updated":
      if (event.status === "blocked" || interpretation.intentFrame === "blocked_work") {
        return "blocking";
      }
      if (
        event.status === "waiting"
        || interpretation.intentFrame === "approval_request"
        || interpretation.intentFrame === "question_request"
        || interpretation.intentFrame === "form_request"
      ) {
        return "waiting";
      }
      return "non_blocking";
    default:
      return "non_blocking";
  }
}

function readOntologyEpisode(
  event: SemanticOntologyEvent,
  interpretation: SemanticInterpretation,
): SemanticOntologyEpisode {
  const relationKinds = new Set(
    interpretation.relationHints.map((hint) => hint.kind),
  );

  if (relationKinds.has("resolves")) {
    return "resolved";
  }

  if (
    relationKinds.has("same_issue")
    && hasResurfacingRelation(interpretation.relationHints)
  ) {
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

function hasResurfacingRelation(
  relationHints: SemanticRelationHint[],
): boolean {
  return relationHints.some((hint) =>
    hint.kind === "repeats"
    || hint.kind === "escalates"
    || hint.kind === "supersedes"
  );
}

function readOntologySource(
  interpretation: SemanticInterpretation,
): SemanticOntologySource {
  const provenanceKinds = Object.values(interpretation.provenance ?? {});

  if (provenanceKinds.includes("hint")) {
    return "hinted";
  }

  if (provenanceKinds.includes("source")) {
    return "explicit";
  }

  if (provenanceKinds.includes("inferred")) {
    return "inferred";
  }

  return "explicit";
}
