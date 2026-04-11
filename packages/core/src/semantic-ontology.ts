import type { ApertureEvent } from "./events.js";
import type { SourceEvent } from "./source-event.js";
import { interpretSourceEvent } from "./semantic-interpreter.js";
import type { SemanticInterpretation, SemanticRelationHint } from "./semantic-types.js";
import type {
  SemanticOntologyActivity,
  SemanticOntologyAsk,
  SemanticOntologyBlocking,
  SemanticOntologyDiagnostic,
  SemanticOntologyEpisode,
  SemanticOntologySource,
} from "./semantic-ontology-types.js";

export type {
  SemanticOntologyActivity,
  SemanticOntologyAsk,
  SemanticOntologyBlocking,
  SemanticOntologyDiagnostic,
  SemanticOntologyEpisode,
  SemanticOntologySource,
} from "./semantic-ontology-types.js";

type SemanticOntologyEvent = SourceEvent | ApertureEvent;

export function readSemanticOntologyDiagnostic(
  event: SourceEvent,
  interpretation = interpretSourceEvent(event),
): SemanticOntologyDiagnostic {
  return projectSemanticOntologyDiagnostic(event, interpretation);
}

// The ontology contract itself lives in `semantic-ontology-types.ts`. This
// module is just the lossy projection from richer semantic interpretation into
// the compact routing vocabulary.

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
    source: readOntologySource(event, interpretation),
  };
}

function readOntologyAsk(
  event: SemanticOntologyEvent,
  interpretation: SemanticInterpretation,
): SemanticOntologyAsk {
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
      return unreachableSemanticOntologyEvent(event);
  }
}

function readOntologyActivity(
  event: SemanticOntologyEvent,
  interpretation: SemanticInterpretation,
): SemanticOntologyActivity {
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
      return unreachableSemanticOntologyEvent(event);
  }
}

function readOntologyBlocking(
  event: SemanticOntologyEvent,
  interpretation: SemanticInterpretation,
): SemanticOntologyBlocking {
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
      return unreachableSemanticOntologyEvent(event);
  }
}

function readOntologyEpisode(
  event: SemanticOntologyEvent,
  interpretation: SemanticInterpretation,
): SemanticOntologyEpisode {
  // The compact ontology keeps only the coarse continuity state. Relation
  // targets remain in full semantic interpretation and traces.
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
  event: SemanticOntologyEvent,
  interpretation: SemanticInterpretation,
): SemanticOntologySource {
  const provenanceKinds = Object.values(interpretation.provenance ?? {});

  if (provenanceKinds.includes("hint")) {
    return "hinted";
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

function isExplicitEventShapedSemanticRead(
  event: SemanticOntologyEvent,
  interpretation: SemanticInterpretation,
): boolean {
  switch (event.type) {
    case "human.input.requested":
      return true;
    case "task.started":
    case "task.completed":
    case "task.cancelled":
      return true;
    case "task.updated":
      switch (event.status) {
        case "blocked":
          return interpretation.intentFrame === "blocked_work";
        case "failed":
          return (
            interpretation.intentFrame === "failure" ||
            interpretation.intentFrame === "status_update"
          );
        case "completed":
          return (
            interpretation.intentFrame === "completion" ||
            interpretation.intentFrame === "status_update"
          );
        case "running":
        case "waiting":
          return interpretation.intentFrame === "status_update";
        default:
          return unreachableTaskStatus(event.status);
      }
    default:
      return unreachableSemanticOntologyEvent(event);
  }
}

function unreachableSemanticOntologyEvent(event: never): never {
  throw new Error(`Unhandled semantic ontology event: ${JSON.stringify(event)}`);
}

function unreachableTaskStatus(status: never): never {
  throw new Error(`Unhandled task status in semantic ontology: ${status}`);
}
