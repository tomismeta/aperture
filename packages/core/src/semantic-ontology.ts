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

export function readSemanticOntologyDiagnostic(
  event: SourceEvent,
  interpretation = interpretSourceEvent(event),
): SemanticOntologyDiagnostic {
  return {
    ask: readOntologyAsk(event),
    activity: readOntologyActivity(event, interpretation),
    ...(interpretation.consequence !== undefined
      ? { consequence: interpretation.consequence }
      : {}),
    blocking: readOntologyBlocking(event),
    episode: readOntologyEpisode(event, interpretation),
    confidence: interpretation.confidence,
    source: readOntologySource(interpretation),
  };
}

function readOntologyAsk(event: SourceEvent): SemanticOntologyAsk {
  switch (event.type) {
    case "human.input.requested":
      return event.request.kind;
    case "task.updated":
      return "status";
    default:
      return "none";
  }
}

function readOntologyActivity(
  event: SourceEvent,
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

function readOntologyBlocking(event: SourceEvent): SemanticOntologyBlocking {
  switch (event.type) {
    case "human.input.requested":
      return "blocking";
    case "task.updated":
      if (event.status === "blocked") {
        return "blocking";
      }
      if (event.status === "waiting") {
        return "waiting";
      }
      return "non_blocking";
    default:
      return "non_blocking";
  }
}

function readOntologyEpisode(
  event: SourceEvent,
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
