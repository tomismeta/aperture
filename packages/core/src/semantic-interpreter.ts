import type { SourceEvent } from "./source-event.js";
import type {
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticFieldProvenance,
  SemanticInterpretation,
  SemanticInterpretationHints,
} from "./semantic-types.js";
import {
  dedupeSemanticStrings,
  detectSemanticRelationHints,
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
        consequence: "low",
        factors: ["task.started"],
        relationHints: [],
        confidence: "high",
        reasons: semanticReasonsForLifecycle("task_started"),
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          consequence: "inferred",
          confidence: "inferred",
        },
      };
    case "task.updated":
      return inferTaskUpdateSemantics(event);
    case "human.input.requested":
      return inferHumanInputSemantics(event);
    case "task.completed":
      return {
        intentFrame: "completion",
        activityClass: "tool_completion",
        consequence: "low",
        factors: ["task.completed"],
        relationHints: [],
        confidence: "high",
        reasons: semanticReasonsForLifecycle("completion"),
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          consequence: "inferred",
          confidence: "inferred",
        },
      };
    case "task.cancelled":
      return {
        intentFrame: "cancellation",
        activityClass: "status_update",
        consequence: "low",
        ...(event.reason
          ? { whyNow: semanticWhyNowForTaskStatus("completed", { wasCancelled: true }) ?? "Work was cancelled and may need review." }
          : {}),
        factors: ["task.cancelled"],
        relationHints: [],
        confidence: "high",
        reasons: semanticReasonsForTaskStatus("completed", { wasCancelled: true }),
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          consequence: "inferred",
          ...(event.reason ? { whyNow: "inferred" as const } : {}),
          confidence: "inferred",
        },
      };
  }
}

function inferTaskUpdateSemantics(
  event: Extract<SourceEvent, { type: "task.updated" }>,
): SemanticInterpretation {
  const text = normalizeSemanticText(`${event.title} ${event.summary ?? ""}`);
  const impliedAsk = detectImpliedOperatorAsk(text);
  const relationHints = detectSemanticRelationHints(text);
  const taxonomyInput = buildTaxonomyInput(event.title, event.summary, event.toolFamily);
  const { toolFamily, source: toolFamilySource } = resolveSemanticToolFamily(taxonomyInput, true);
  const relationProvenance = relationHints.length > 0 ? { relationHints: "inferred" as const } : {};

  switch (event.status) {
    case "failed":
      return {
        intentFrame: "failure",
        activityClass: "tool_failure",
        ...(toolFamily ? { toolFamily } : {}),
        consequence: inferConsequenceFromSemanticText(text, "high", toolFamily),
        whyNow: semanticWhyNowForTaskStatus("failed") ?? "Work has failed and should be reviewed.",
        factors: ["task.updated", "failed"],
        relationHints,
        confidence: impliedAsk ? "medium" : "high",
        reasons: semanticReasonsForTaskStatus("failed", { impliedAsk }),
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          ...(toolFamilySource === "explicit"
            ? { toolFamily: "source" as const }
            : toolFamilySource === "inferred"
              ? { toolFamily: "inferred" as const }
              : {}),
          consequence: "inferred",
          whyNow: "inferred",
          ...relationProvenance,
          confidence: "inferred",
        },
      };
    case "blocked":
      return {
        intentFrame: "blocked_work",
        activityClass: "status_update",
        ...(toolFamily ? { toolFamily } : {}),
        consequence: inferConsequenceFromSemanticText(text, "medium", toolFamily),
        whyNow: semanticWhyNowForTaskStatus("blocked") ?? "Work is blocked and may require operator attention.",
        factors: ["task.updated", "blocked"],
        relationHints,
        confidence: impliedAsk ? "medium" : "high",
        reasons: semanticReasonsForTaskStatus("blocked", { impliedAsk }),
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          ...(toolFamilySource === "explicit"
            ? { toolFamily: "source" as const }
            : toolFamilySource === "inferred"
              ? { toolFamily: "inferred" as const }
              : {}),
          consequence: "inferred",
          whyNow: "inferred",
          ...relationProvenance,
          confidence: "inferred",
        },
      };
    case "running":
    case "waiting":
    case "completed":
      return {
        intentFrame: "status_update",
        activityClass: "status_update",
        ...(toolFamily ? { toolFamily } : {}),
        consequence: inferConsequenceFromSemanticText(text, "low", toolFamily),
        ...(() => {
          const whyNow = impliedAsk ? semanticWhyNowForTaskStatus(event.status, { impliedAsk }) : undefined;
          return whyNow !== undefined ? { whyNow } : {};
        })(),
        factors: ["task.updated", event.status],
        relationHints,
        confidence: impliedAsk ? "low" : "high",
        reasons: semanticReasonsForTaskStatus(event.status, { impliedAsk }),
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          ...(toolFamilySource === "explicit"
            ? { toolFamily: "source" as const }
            : toolFamilySource === "inferred"
              ? { toolFamily: "inferred" as const }
              : {}),
          consequence: "inferred",
          ...(impliedAsk ? { whyNow: "inferred" as const } : {}),
          ...relationProvenance,
          confidence: "inferred",
        },
      };
  }
}

function inferHumanInputSemantics(
  event: Extract<SourceEvent, { type: "human.input.requested" }>,
): SemanticInterpretation {
  const taxonomyInput = buildTaxonomyInput(event.title, event.summary, event.toolFamily, event.context);
  const { toolFamily, source: toolFamilySource } = resolveSemanticToolFamily(
    taxonomyInput,
    event.request.kind === "approval",
  );
  const text = normalizeSemanticText(`${event.title} ${event.summary}`);
  const relationHints = detectSemanticRelationHints(text);
  const baseConsequence = event.riskHint ?? consequenceFromRequestKind(event.request.kind, toolFamily);
  const consequence = inferConsequenceFromSemanticText(text, baseConsequence, toolFamily);
  const relationProvenance = relationHints.length > 0 ? { relationHints: "inferred" as const } : {};
  const toolFamilyProvenance =
    toolFamilySource === "explicit"
      ? { toolFamily: "source" as const }
      : toolFamilySource === "inferred"
        ? { toolFamily: "inferred" as const }
        : {};

  return {
    intentFrame: semanticIntentFrameForRequestKind(event.request.kind),
    activityClass: semanticActivityClassForRequestKind(event.request.kind),
    ...(toolFamily ? { toolFamily } : {}),
    consequence,
    whyNow: semanticWhyNowForRequestKind(event.request.kind, consequence),
    factors: ["human.input.requested", event.request.kind],
    relationHints,
    confidence:
      event.riskHint
        ? "high"
        : event.request.kind === "approval" && toolFamily
          ? "medium"
          : "low",
    reasons: [
      event.riskHint
        ? "source provided an explicit risk hint"
        : "request kind establishes an explicit operator decision point",
      ...(toolFamilySource === "explicit"
        ? ["tool family was supplied by the source or context"]
        : toolFamilySource === "inferred"
          ? ["tool family was inferred from approval wording"]
          : []),
    ],
    provenance: {
      intentFrame: "inferred",
      activityClass: "inferred",
      ...toolFamilyProvenance,
      consequence: event.riskHint ? "source" : "inferred",
      whyNow: "inferred",
      ...relationProvenance,
      confidence: event.riskHint ? "source" : "inferred",
    },
  };
}

function resolveSemanticToolFamily(
  input: {
    title: string;
    summary?: string;
    toolFamily?: string;
    context?: {
      items?: SemanticDetectionContextItem[];
    };
  },
  allowTextInference: boolean,
): {
  toolFamily?: string;
  source: "explicit" | "inferred" | "none";
} {
  const explicit = readExplicitSemanticToolFamily(input);
  if (explicit) {
    return { toolFamily: explicit, source: "explicit" };
  }

  if (!allowTextInference) {
    return { source: "none" };
  }

  const inferred = inferSemanticToolFamily(input);
  if (inferred) {
    return { toolFamily: inferred, source: "inferred" };
  }

  return { source: "none" };
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
    provenance: {
      ...(inferred.provenance ?? {}),
      ...hintedSemanticProvenance(hints),
    },
  };
}

function hintedSemanticProvenance(
  hints: SemanticInterpretationHints,
): SemanticFieldProvenance {
  return {
    ...(hints.intentFrame !== undefined ? { intentFrame: "hint" as const } : {}),
    ...(hints.activityClass !== undefined ? { activityClass: "hint" as const } : {}),
    ...(hints.toolFamily !== undefined ? { toolFamily: "hint" as const } : {}),
    ...(hints.consequence !== undefined ? { consequence: "hint" as const } : {}),
    ...(hints.whyNow !== undefined ? { whyNow: "hint" as const } : {}),
    ...(hints.relationHints !== undefined ? { relationHints: "hint" as const } : {}),
    ...(hints.confidence !== undefined ? { confidence: "hint" as const } : {}),
    ...(hints.abstained !== undefined ? { abstained: "hint" as const } : {}),
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
