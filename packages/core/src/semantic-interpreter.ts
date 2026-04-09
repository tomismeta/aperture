import type { SourceEvent } from "./source-event.js";
import type {
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticFieldProvenance,
  SemanticInterpretation,
  SemanticInterpretationHints,
} from "./semantic-types.js";
import {
  detectExpectedDiagnosticFailure,
  detectSemanticBlockingSignal,
  detectRoutineObservationalFailureLowConsequence,
  dedupeSemanticStrings,
  detectObservationalFailureStatus,
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
type SemanticProvenanceField = keyof SemanticFieldProvenance;

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
        provenance: inferredSemanticProvenance([
          "intentFrame",
          "activityClass",
          "consequence",
          "confidence",
        ]),
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
        provenance: inferredSemanticProvenance([
          "intentFrame",
          "activityClass",
          "consequence",
          "confidence",
        ]),
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
          ...inferredSemanticProvenance([
            "intentFrame",
            "activityClass",
            "consequence",
            "confidence",
          ]),
          ...(event.reason ? inferredSemanticProvenance(["whyNow"]) : {}),
        },
      };
    default:
      return unreachableSourceEvent(event);
  }
}

function inferTaskUpdateSemantics(
  event: Extract<SourceEvent, { type: "task.updated" }>,
): SemanticInterpretation {
  const text = normalizeSemanticText(`${event.title} ${event.summary ?? ""}`);
  const impliedAsk = detectImpliedOperatorAsk(text);
  const blockingSignal = detectSemanticBlockingSignal(text);
  const relationHints = detectSemanticRelationHints(text);
  const taxonomyInput = buildTaxonomyInput(event.title, event.summary, event.toolFamily, event.context);
  const { toolFamily, source: toolFamilySource } = resolveSemanticToolFamily(taxonomyInput, true);
  const relationProvenance = relationHints.length > 0
    ? inferredSemanticProvenance(["relationHints"])
    : {};
  const observationalFailure = event.status === "failed"
    && detectObservationalFailureStatus(text, toolFamily);
  const routineObservationalFailureLowConsequence = event.status === "failed"
    && detectRoutineObservationalFailureLowConsequence(text, toolFamily);
  const expectedDiagnosticFailure = event.status === "failed"
    && detectExpectedDiagnosticFailure(text, toolFamily);

  switch (event.status) {
    case "failed":
      if (observationalFailure) {
        return {
          intentFrame: "status_update",
          activityClass: "status_update",
          ...(toolFamily ? { toolFamily } : {}),
          consequence: inferConsequenceFromSemanticText(
            text,
            routineObservationalFailureLowConsequence ? "low" : "high",
            toolFamily,
          ),
          factors: ["task.updated", "failed", "observational_failure"],
          relationHints,
          confidence: "high",
          reasons: [
            "task status indicates failure but the update reads like observational output",
          ],
          provenance: {
            ...inferredSemanticProvenance([
              "intentFrame",
              "activityClass",
              "consequence",
              "confidence",
            ]),
            ...semanticToolFamilyProvenance(toolFamilySource),
            ...relationProvenance,
          },
        };
      }

      return {
        intentFrame: "failure",
        activityClass: "tool_failure",
        ...(toolFamily ? { toolFamily } : {}),
        consequence: inferConsequenceFromSemanticText(
          text,
          routineObservationalFailureLowConsequence
            ? "low"
            : expectedDiagnosticFailure
              ? "medium"
              : "high",
          toolFamily,
        ),
        whyNow: semanticWhyNowForTaskStatus("failed") ?? "Work has failed and should be reviewed.",
        factors: ["task.updated", "failed"],
        relationHints,
        confidence: impliedAsk ? "medium" : "high",
        reasons: expectedDiagnosticFailure
          ? [
              ...semanticReasonsForTaskStatus("failed", { impliedAsk }),
              "failure content looks like expected diagnostic output from repro work",
            ]
          : semanticReasonsForTaskStatus("failed", { impliedAsk }),
        provenance: {
          ...inferredSemanticProvenance([
            "intentFrame",
            "activityClass",
            "consequence",
            "whyNow",
            "confidence",
          ]),
          ...semanticToolFamilyProvenance(toolFamilySource),
          ...relationProvenance,
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
          ...inferredSemanticProvenance([
            "intentFrame",
            "activityClass",
            "consequence",
            "whyNow",
            "confidence",
          ]),
          ...semanticToolFamilyProvenance(toolFamilySource),
          ...relationProvenance,
        },
      };
    case "running":
    case "waiting":
    case "completed":
      return {
        intentFrame: blockingSignal === "blocking" ? "blocked_work" : "status_update",
        activityClass: "status_update",
        ...(toolFamily ? { toolFamily } : {}),
        consequence: inferConsequenceFromSemanticText(text, "low", toolFamily),
        ...(() => {
          const whyNow = blockingSignal === "blocking"
            ? semanticWhyNowForTaskStatus("blocked")
            : impliedAsk
              ? semanticWhyNowForTaskStatus(event.status, { impliedAsk })
              : undefined;
          return whyNow !== undefined ? { whyNow } : {};
        })(),
        factors: [
          "task.updated",
          event.status,
          ...(blockingSignal === "blocking" ? ["semantic blocking signal"] : []),
        ],
        relationHints,
        confidence: blockingSignal === "blocking"
          ? "medium"
          : impliedAsk
            ? "low"
            : "high",
        reasons: blockingSignal === "blocking"
          ? [
              ...semanticReasonsForTaskStatus("blocked"),
              "status wording indicates work cannot continue yet",
            ]
          : semanticReasonsForTaskStatus(event.status, { impliedAsk }),
        provenance: {
          ...inferredSemanticProvenance([
            "intentFrame",
            "activityClass",
            "consequence",
            "confidence",
          ]),
          ...semanticToolFamilyProvenance(toolFamilySource),
          ...((blockingSignal === "blocking" || impliedAsk)
            ? inferredSemanticProvenance(["whyNow"])
            : {}),
          ...relationProvenance,
        },
      };
    default:
      return unreachableTaskStatus(event.status);
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
  const relationProvenance = relationHints.length > 0
    ? inferredSemanticProvenance(["relationHints"])
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
      ...inferredSemanticProvenance(["intentFrame", "activityClass", "whyNow"]),
      ...semanticToolFamilyProvenance(toolFamilySource),
      ...(event.riskHint
        ? sourceSemanticProvenance(["consequence", "confidence"])
        : inferredSemanticProvenance(["consequence", "confidence"])),
      ...relationProvenance,
    },
  };
}

function inferredSemanticProvenance(
  fields: SemanticProvenanceField[],
): SemanticFieldProvenance {
  return semanticFieldProvenance(fields, "inferred");
}

function sourceSemanticProvenance(
  fields: SemanticProvenanceField[],
): SemanticFieldProvenance {
  return semanticFieldProvenance(fields, "source");
}

function semanticFieldProvenance(
  fields: SemanticProvenanceField[],
  kind: "inferred" | "source",
): SemanticFieldProvenance {
  return Object.fromEntries(fields.map((field) => [field, kind])) as SemanticFieldProvenance;
}

function semanticToolFamilyProvenance(
  source: "explicit" | "inferred" | "none",
): SemanticFieldProvenance {
  switch (source) {
    case "explicit":
      return sourceSemanticProvenance(["toolFamily"]);
    case "inferred":
      return inferredSemanticProvenance(["toolFamily"]);
    case "none":
      return {};
    default:
      return unreachableToolFamilySource(source);
  }
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
    default:
      return unreachableRequestKind(kind);
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

function unreachableSourceEvent(event: never): never {
  throw new Error(`Unhandled source event in semantic interpreter: ${JSON.stringify(event)}`);
}

function unreachableTaskStatus(status: never): never {
  throw new Error(`Unhandled task status in semantic interpreter: ${status}`);
}

function unreachableRequestKind(kind: never): never {
  throw new Error(`Unhandled human input request kind in semantic interpreter: ${kind}`);
}

function unreachableToolFamilySource(source: never): never {
  throw new Error(`Unhandled tool family provenance source in semantic interpreter: ${source}`);
}
