import type { SourceEvent } from "./source-event.js";
import type {
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticInterpretation,
  SemanticInterpretationHints,
} from "./semantic-types.js";
import {
  dedupeSemanticStrings,
  detectImpliedOperatorAsk,
  inferConsequenceFromSemanticText,
  inferSemanticToolFamily,
  normalizeSemanticText,
  readExplicitSemanticToolFamily,
  type SemanticDetectionContextItem,
} from "./semantic-detection.js";
import {
  semanticActivityClassForRequestKind,
  semanticIntentFrameForRequestKind,
  semanticReasonsForLifecycle,
  semanticReasonsForTaskStatus,
  semanticWhyNowForRequestKind,
  semanticWhyNowForTaskStatus,
} from "./semantic-language.js";

export type SemanticInterpreter = (event: SourceEvent) => SemanticInterpretation;

export function interpretSourceEvent(event: SourceEvent): SemanticInterpretation {
  const inferred = inferSemanticInterpretation(event);
  return applySemanticHints(inferred, event.semanticHints);
}

function inferSemanticInterpretation(event: SourceEvent): SemanticInterpretation {
  switch (event.type) {
    case "task.started":
      return {
        intentFrame: "task_started",
        activityClass: "session_status",
        operatorActionRequired: false,
        requestExplicitness: "none",
        consequence: "low",
        factors: ["task.started"],
        relationHints: [],
        confidence: "high",
        reasons: semanticReasonsForLifecycle("task_started"),
      };
    case "task.updated":
      return inferTaskUpdateSemantics(event);
    case "human.input.requested":
      return inferHumanInputSemantics(event);
    case "task.completed":
      return {
        intentFrame: "completion",
        activityClass: "tool_completion",
        operatorActionRequired: false,
        requestExplicitness: "none",
        consequence: "low",
        factors: ["task.completed"],
        relationHints: [],
        confidence: "high",
        reasons: semanticReasonsForLifecycle("completion"),
      };
    case "task.cancelled":
      return {
        intentFrame: "cancellation",
        activityClass: "status_update",
        operatorActionRequired: false,
        requestExplicitness: "none",
        consequence: "low",
        ...(event.reason
          ? { whyNow: semanticWhyNowForTaskStatus("completed", { wasCancelled: true }) ?? "Work was cancelled and may need review." }
          : {}),
        factors: ["task.cancelled"],
        relationHints: [],
        confidence: "high",
        reasons: semanticReasonsForTaskStatus("completed", { wasCancelled: true }),
      };
  }
}

function inferTaskUpdateSemantics(
  event: Extract<SourceEvent, { type: "task.updated" }>,
): SemanticInterpretation {
  const text = normalizeSemanticText(`${event.title} ${event.summary ?? ""}`);
  const impliedAsk = detectImpliedOperatorAsk(text);
  const taxonomyInput = buildTaxonomyInput(event.title, event.summary, event.toolFamily);
  const toolFamily =
    readExplicitSemanticToolFamily(taxonomyInput) ?? inferSemanticToolFamily(taxonomyInput) ?? undefined;

  switch (event.status) {
    case "failed":
      return {
        intentFrame: "failure",
        activityClass: "tool_failure",
        ...(toolFamily ? { toolFamily } : {}),
        operatorActionRequired: true,
        requestExplicitness: impliedAsk ? "implied" : "none",
        consequence: inferConsequenceFromSemanticText(text, "high", toolFamily),
        whyNow: semanticWhyNowForTaskStatus("failed") ?? "Work has failed and should be reviewed.",
        factors: ["task.updated", "failed"],
        relationHints: [],
        confidence: impliedAsk ? "medium" : "high",
        reasons: semanticReasonsForTaskStatus("failed", { impliedAsk }),
      };
    case "blocked":
      return {
        intentFrame: "blocked_work",
        activityClass: "status_update",
        ...(toolFamily ? { toolFamily } : {}),
        operatorActionRequired: true,
        requestExplicitness: impliedAsk ? "implied" : "none",
        consequence: inferConsequenceFromSemanticText(text, "medium", toolFamily),
        whyNow: semanticWhyNowForTaskStatus("blocked") ?? "Work is blocked and may require operator attention.",
        factors: ["task.updated", "blocked"],
        relationHints: [],
        confidence: impliedAsk ? "medium" : "high",
        reasons: semanticReasonsForTaskStatus("blocked", { impliedAsk }),
      };
    case "running":
    case "waiting":
    case "completed":
      return {
        intentFrame: "status_update",
        activityClass: "status_update",
        ...(toolFamily ? { toolFamily } : {}),
        operatorActionRequired: impliedAsk,
        requestExplicitness: impliedAsk ? "implied" : "none",
        consequence: inferConsequenceFromSemanticText(text, "low", toolFamily),
        ...(() => {
          const whyNow = impliedAsk ? semanticWhyNowForTaskStatus(event.status, { impliedAsk }) : undefined;
          return whyNow !== undefined ? { whyNow } : {};
        })(),
        factors: ["task.updated", event.status],
        relationHints: [],
        confidence: impliedAsk ? "low" : "high",
        reasons: semanticReasonsForTaskStatus(event.status, { impliedAsk }),
      };
  }
}

function inferHumanInputSemantics(
  event: Extract<SourceEvent, { type: "human.input.requested" }>,
): SemanticInterpretation {
  const taxonomyInput = buildTaxonomyInput(event.title, event.summary, event.toolFamily, event.context);
  const toolFamily =
    readExplicitSemanticToolFamily(taxonomyInput) ?? inferSemanticToolFamily(taxonomyInput) ?? undefined;
  const text = normalizeSemanticText(`${event.title} ${event.summary}`);
  const baseConsequence = event.riskHint ?? consequenceFromRequestKind(event.request.kind, toolFamily);
  const consequence = inferConsequenceFromSemanticText(text, baseConsequence, toolFamily);

  return {
    intentFrame: semanticIntentFrameForRequestKind(event.request.kind),
    activityClass: semanticActivityClassForRequestKind(event.request.kind),
    ...(toolFamily ? { toolFamily } : {}),
    operatorActionRequired: true,
    requestExplicitness: "explicit",
    consequence,
    whyNow: semanticWhyNowForRequestKind(event.request.kind, consequence),
    factors: ["human.input.requested", event.request.kind],
    relationHints: [],
    confidence: event.riskHint ? "high" : toolFamily ? "medium" : "low",
    reasons: [
      event.riskHint
        ? "source provided an explicit risk hint"
        : "request kind establishes an explicit operator decision point",
      ...(toolFamily ? ["tool family was inferred or supplied"] : []),
    ],
  };
}

function applySemanticHints(
  inferred: SemanticInterpretation,
  hints: SemanticInterpretationHints | undefined,
): SemanticInterpretation {
  if (!hints) {
    return inferred;
  }

  return {
    ...inferred,
    ...pickDefined(hints),
    factors: dedupeSemanticStrings([...(inferred.factors ?? []), ...(hints.factors ?? [])]),
    relationHints: [...(hints.relationHints ?? inferred.relationHints)],
    reasons: dedupeSemanticStrings([...(inferred.reasons ?? []), ...(hints.reasons ?? [])]),
  };
}

function pickDefined<T extends object>(value: T): Partial<T> {
  const next: Partial<T> = {};
  for (const [key, entry] of Object.entries(value) as Array<[keyof T, T[keyof T]]>) {
    if (entry !== undefined && key !== "factors" && key !== "relationHints" && key !== "reasons") {
      next[key] = entry;
    }
  }
  return next;
}

function consequenceFromRequestKind(
  kind: "approval" | "choice" | "form",
  toolFamily?: string,
): SemanticConsequenceLevel {
  switch (kind) {
    case "approval":
      if (toolFamily === "read" || toolFamily === "search") {
        return "low";
      }
      if (toolFamily === "write" || toolFamily === "edit" || toolFamily === "bash") {
        return "medium";
      }
      return "medium";
    case "choice":
    case "form":
      return "medium";
  }
}

function buildTaxonomyInput(
  title: string,
  summary?: string,
  toolFamily?: string,
  context?: Extract<SourceEvent, { type: "human.input.requested" }>["context"],
): {
  title: string;
  summary?: string;
  toolFamily?: string;
  context?: {
    items?: SemanticDetectionContextItem[];
  };
} {
  return {
    title,
    ...(summary !== undefined ? { summary } : {}),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    ...(context?.items !== undefined ? { context: { items: context.items } } : {}),
  };
}
