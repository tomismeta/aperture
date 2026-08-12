import type { SourceEvent } from "./source-event.js";
import {
  TRUNCATED_SOURCE_EVIDENCE_FACTOR,
  type SemanticConsequenceLevel,
  type SemanticConfidence,
  type SemanticFieldProvenance,
  type SemanticInterpretation,
  type SemanticInterpretationHints,
  type SemanticRelationHint,
} from "./semantic-types.js";
import {
  detectSemanticBlockingSignal,
  dedupeSemanticStrings,
  detectSemanticRelationHints,
  detectImpliedOperatorAsk,
  inferConsequenceFromSemanticText,
  inferSemanticToolFamily,
  normalizeSemanticText,
  readExplicitSemanticToolFamily,
} from "./semantic-detection.js";
import {
  semanticActivityClassForRequestKind,
  semanticIntentFrameForRequestKind,
  semanticReasonsForCompletedTaskUpdate,
  semanticReasonsForLifecycle,
  semanticWhyNowForObservationalStatusConflict,
  semanticWhyNowForRelationHints,
  semanticReasonsForTaskStatus,
  semanticWhyNowForRequestKind,
  semanticWhyNowForTaskStatus,
} from "./semantic-language.js";
import { observationReadsAsStatusUpdate } from "./observation-semantic-read.js";
import { projectTaskFailureObservationFromEvent } from "./task-failure-observation-reader.js";

type SemanticProvenanceField = keyof SemanticFieldProvenance;

export function interpretSourceEvent(event: SourceEvent): SemanticInterpretation {
  return applySemanticHints(inferSemanticInterpretation(event), readApplicableSemanticHints(event));
}

function readApplicableSemanticHints(event: SourceEvent): SemanticInterpretationHints | undefined {
  const hints = event.semanticHints;
  if (event.type !== "task.updated" || event.status !== "failed" || hints === undefined)
    return hints;
  const relationOnly = hints.relationHints && { relationHints: hints.relationHints };
  const observation = projectTaskFailureObservationFromEvent(event);
  if (
    event.evidence === undefined &&
    observation !== null &&
    observation.evidenceLoss === "partial" &&
    hints.confidence === "low" &&
    hints.factors?.includes(TRUNCATED_SOURCE_EVIDENCE_FACTOR) === true &&
    (hints.consequence === undefined || hints.consequence === "high")
  )
    return {
      ...relationOnly,
      ...(hints.consequence === undefined ? {} : { consequence: hints.consequence }),
      confidence: "low",
      factors: [TRUNCATED_SOURCE_EVIDENCE_FACTOR],
      ...(hints.reasons === undefined ? {} : { reasons: hints.reasons }),
    };
  return relationOnly;
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
          ? {
              whyNow:
                semanticWhyNowForTaskStatus("completed", { wasCancelled: true }) ??
                "Work was cancelled and may need review.",
            }
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
  const rawText = joinSemanticTextParts(event.title, event.summary);
  const text = normalizeSemanticText(`${event.title} ${event.summary ?? ""}`);
  const impliedAsk = detectImpliedOperatorAsk(text);
  const blockingSignal = detectSemanticBlockingSignal(text);
  const relationHints = detectSemanticRelationHints(rawText);
  const evidenceAuthority = event.status === "failed" && event.evidence !== undefined;
  const taxonomyInput = buildTaxonomyInput(event.title, event.summary, event.toolFamily);
  const failureObservationCore =
    event.status === "failed" ? projectTaskFailureObservationFromEvent(event) : null;
  const awaitsAuthorization = failureObservationCore?.recoveryHint === "await_authorization";
  const { toolFamily, source: toolFamilySource } = resolveSemanticToolFamily(
    taxonomyInput,
    !awaitsAuthorization && !evidenceAuthority && failureObservationCore === null,
  );
  const relationProvenance =
    relationHints.length > 0 ? inferredSemanticProvenance(["relationHints"]) : {};
  const relationWhyNow = semanticWhyNowForRelationHints(relationHints);
  const observationalFailure = observationReadsAsStatusUpdate(failureObservationCore);
  const hasExpectedDiagnosticClass = failureObservationCore?.diagnosticClass === "expected";

  switch (event.status) {
    case "failed":
      if (observationalFailure) {
        const consequence = failureObservationCore?.consequenceBaseline ?? "high";
        const whyNow = semanticWhyNowForObservationalStatusConflict(consequence) ?? relationWhyNow;
        return {
          intentFrame: "status_update",
          activityClass: "status_update",
          ...(toolFamily ? { toolFamily } : {}),
          consequence,
          ...(whyNow !== undefined ? { whyNow } : {}),
          factors: [
            "task.updated",
            "failed",
            evidenceAuthority ? "source_evidence" : "observational_failure",
          ],
          relationHints,
          confidence: "high",
          reasons: [
            evidenceAuthority
              ? "typed source evidence determines the failed update meaning"
              : "task status indicates failure but the update reads like observational output",
          ],
          provenance: {
            ...(evidenceAuthority ? sourceSemanticProvenance : inferredSemanticProvenance)([
              "intentFrame",
              "activityClass",
              "consequence",
              ...(whyNow !== undefined ? (["whyNow"] as const) : []),
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
        consequence: evidenceAuthority
          ? (failureObservationCore?.consequenceBaseline ?? "high")
          : inferConsequenceFromSemanticText(
              text,
              failureObservationCore?.consequenceBaseline ?? "high",
              toolFamily,
            ),
        whyNow: semanticWhyNowForTaskStatus("failed") ?? "Work has failed and should be reviewed.",
        factors: ["task.updated", "failed", ...(evidenceAuthority ? ["source_evidence"] : [])],
        relationHints,
        confidence: evidenceAuthority ? "high" : impliedAsk ? "medium" : "high",
        reasons: evidenceAuthority
          ? ["typed source evidence determines the failed update meaning"]
          : hasExpectedDiagnosticClass
            ? [
                ...semanticReasonsForTaskStatus("failed", { impliedAsk }),
                "failure content looks like expected diagnostic output from repro work",
              ]
            : semanticReasonsForTaskStatus("failed", { impliedAsk }),
        provenance: {
          ...(evidenceAuthority ? sourceSemanticProvenance : inferredSemanticProvenance)([
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
        whyNow:
          semanticWhyNowForTaskStatus("blocked") ??
          "Work is blocked and may require operator attention.",
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
      if (event.status === "completed" && blockingSignal === null && !impliedAsk) {
        const activityClass = event.activityClass ?? "tool_completion";

        return {
          intentFrame: "completion",
          activityClass,
          ...(toolFamily ? { toolFamily } : {}),
          consequence: inferConsequenceFromSemanticText(text, "low", toolFamily),
          ...(relationWhyNow !== undefined ? { whyNow: relationWhyNow } : {}),
          factors: ["task.updated", "completed"],
          relationHints,
          confidence: "high",
          reasons: semanticReasonsForCompletedTaskUpdate(),
          provenance: {
            ...inferredSemanticProvenance([
              "intentFrame",
              "consequence",
              ...(relationWhyNow !== undefined ? (["whyNow"] as const) : []),
              "confidence",
            ]),
            ...(event.activityClass === undefined
              ? inferredSemanticProvenance(["activityClass"])
              : sourceSemanticProvenance(["activityClass"])),
            ...semanticToolFamilyProvenance(toolFamilySource),
            ...relationProvenance,
          },
        };
      }

      return {
        intentFrame: blockingSignal === "blocking" ? "blocked_work" : "status_update",
        activityClass: "status_update",
        ...(toolFamily ? { toolFamily } : {}),
        consequence: inferConsequenceFromSemanticText(
          text,
          blockingSignal === "blocking" ? "medium" : "low",
          toolFamily,
        ),
        ...(() => {
          const whyNow =
            blockingSignal === "blocking"
              ? semanticWhyNowForTaskStatus("blocked")
              : impliedAsk
                ? semanticWhyNowForTaskStatus(event.status, { impliedAsk })
                : relationWhyNow;
          return whyNow !== undefined ? { whyNow } : {};
        })(),
        factors: [
          "task.updated",
          event.status,
          ...(blockingSignal === "blocking" ? ["semantic blocking signal"] : []),
        ],
        relationHints,
        confidence: blockingSignal === "blocking" ? "medium" : impliedAsk ? "low" : "high",
        reasons:
          blockingSignal === "blocking"
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
          ...(blockingSignal === "blocking" || impliedAsk || relationWhyNow !== undefined
            ? inferredSemanticProvenance(["whyNow"])
            : {}),
          ...relationProvenance,
        },
      };
  }
}

function inferHumanInputSemantics(
  event: Extract<SourceEvent, { type: "human.input.requested" }>,
): SemanticInterpretation {
  const taxonomyInput = buildTaxonomyInput(event.title, event.summary, event.toolFamily);
  const { toolFamily, source: toolFamilySource } = resolveSemanticToolFamily(
    taxonomyInput,
    event.request.kind === "approval",
  );
  const rawText = joinSemanticTextParts(event.title, event.summary);
  const text = normalizeSemanticText(rawText);
  const relationHints = detectSemanticRelationHints(rawText);
  const baseConsequence =
    event.riskHint ?? consequenceFromRequestKind(event.request.kind, toolFamily);
  const consequence = inferConsequenceFromSemanticText(text, baseConsequence, toolFamily);
  const relationProvenance =
    relationHints.length > 0 ? inferredSemanticProvenance(["relationHints"]) : {};
  const hasSourceBackedConfidence = event.riskHint === "high";
  const confidence = hasSourceBackedConfidence
    ? "high"
    : event.request.kind === "approval" && toolFamily
      ? "medium"
      : "low";

  return {
    intentFrame: semanticIntentFrameForRequestKind(event.request.kind),
    activityClass: semanticActivityClassForRequestKind(event.request.kind),
    ...(toolFamily ? { toolFamily } : {}),
    consequence,
    whyNow: semanticWhyNowForRequestKind(event.request.kind, consequence),
    factors: ["human.input.requested", event.request.kind],
    relationHints,
    confidence,
    reasons: [
      event.riskHint
        ? "source provided an explicit risk hint"
        : "request kind establishes an explicit operator decision point",
      ...(toolFamilySource === "explicit"
        ? ["tool family was supplied by the source event"]
        : toolFamilySource === "inferred"
          ? ["tool family was inferred from approval wording"]
          : []),
    ],
    provenance: {
      ...inferredSemanticProvenance(["intentFrame", "activityClass", "whyNow"]),
      ...semanticToolFamilyProvenance(toolFamilySource),
      ...(event.riskHint
        ? {
            ...sourceSemanticProvenance(["consequence"]),
            ...(hasSourceBackedConfidence
              ? sourceSemanticProvenance(["confidence"])
              : inferredSemanticProvenance(["confidence"])),
          }
        : inferredSemanticProvenance(["consequence", "confidence"])),
      ...relationProvenance,
    },
  };
}

function inferredSemanticProvenance(fields: SemanticProvenanceField[]): SemanticFieldProvenance {
  return semanticFieldProvenance(fields, "inferred");
}

function sourceSemanticProvenance(fields: SemanticProvenanceField[]): SemanticFieldProvenance {
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

function joinSemanticTextParts(title: string, summary?: string): string {
  return summary ? `${title}. ${summary}` : title;
}

function resolveSemanticToolFamily(
  input: {
    title: string;
    summary?: string;
    toolFamily?: string;
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

  const overridden = pickDefined(hints);
  const confidence = mergeSemanticConfidence(inferred.confidence, hints.confidence);
  const relationHints = mergeSemanticRelationHints(inferred.relationHints, hints.relationHints);

  return {
    ...inferred,
    ...overridden,
    confidence,
    factors: dedupeSemanticStrings([...(inferred.factors ?? []), ...(hints.factors ?? [])]),
    relationHints,
    reasons: dedupeSemanticStrings([...(inferred.reasons ?? []), ...(hints.reasons ?? [])]),
    provenance: {
      ...(inferred.provenance ?? {}),
      ...hintedSemanticProvenance(
        inferred,
        {
          ...overridden,
          confidence,
          relationHints,
        },
        hints,
      ),
    },
  };
}

function hintedSemanticProvenance(
  inferred: SemanticInterpretation,
  merged: Partial<SemanticInterpretation>,
  hints: SemanticInterpretationHints,
): SemanticFieldProvenance {
  return {
    ...hintedFieldProvenance("intentFrame", inferred, merged),
    ...hintedFieldProvenance("activityClass", inferred, merged),
    ...hintedFieldProvenance("toolFamily", inferred, merged),
    ...hintedFieldProvenance("consequence", inferred, merged),
    ...hintedFieldProvenance("whyNow", inferred, merged),
    ...hintedRelationProvenance(inferred.relationHints, hints.relationHints),
    ...hintedFieldProvenance("confidence", inferred, merged),
    ...hintedFieldProvenance("abstained", inferred, merged),
  };
}

function pickDefined<T extends object>(value: T): Partial<T> {
  const next: Partial<T> = {};
  for (const [key, entry] of Object.entries(value) as Array<[keyof T, T[keyof T]]>) {
    if (
      entry !== undefined &&
      key !== "confidence" &&
      key !== "factors" &&
      key !== "relationHints" &&
      key !== "reasons"
    ) {
      next[key] = entry;
    }
  }
  return next;
}

function mergeSemanticConfidence(
  inferred: SemanticConfidence,
  hinted: SemanticConfidence | undefined,
): SemanticConfidence {
  if (hinted === undefined) return inferred;
  return CONFIDENCE_WEIGHT[hinted] < CONFIDENCE_WEIGHT[inferred] ? hinted : inferred;
}
const CONFIDENCE_WEIGHT: Record<SemanticConfidence, number> = { high: 3, low: 1, medium: 2 };

function mergeSemanticRelationHints(
  inferred: SemanticRelationHint[],
  hinted: SemanticRelationHint[] | undefined,
): SemanticRelationHint[] {
  if (!hinted || hinted.length === 0) {
    return inferred;
  }

  const seen = new Set<string>();
  const result: SemanticRelationHint[] = [];

  for (const hint of [...inferred, ...hinted]) {
    const key = semanticRelationHintKey(hint);
    if (seen.has(key)) {
      continue;
    }

    const targetlessIndex = result.findIndex(
      (entry) => entry.kind === hint.kind && entry.target === undefined,
    );
    if (hint.target !== undefined && targetlessIndex >= 0) {
      seen.delete(semanticRelationHintKey(result[targetlessIndex]!));
      result[targetlessIndex] = hint;
      seen.add(key);
      continue;
    }
    if (
      hint.target === undefined &&
      result.some((entry) => entry.kind === hint.kind && entry.target !== undefined)
    ) {
      continue;
    }

    seen.add(key);
    result.push(hint);
  }

  return result;
}

function hintedFieldProvenance<Field extends keyof SemanticFieldProvenance>(
  field: Field,
  inferred: SemanticInterpretation,
  merged: Partial<SemanticInterpretation>,
): SemanticFieldProvenance {
  if (!(field in merged) || merged[field] === inferred[field]) {
    return {};
  }

  return { [field]: "hint" } as SemanticFieldProvenance;
}

function hintedRelationProvenance(
  inferred: SemanticRelationHint[],
  hints: SemanticRelationHint[] | undefined,
): SemanticFieldProvenance {
  if (!hints || hints.length === 0) {
    return {};
  }

  const inferredKeys = new Set(inferred.map(semanticRelationHintKey));
  const hasNewRelationHint = hints.some((hint) => !inferredKeys.has(semanticRelationHintKey(hint)));

  return hasNewRelationHint ? { relationHints: "hint" } : {};
}

function semanticRelationHintKey(hint: SemanticRelationHint): string {
  return `${hint.kind}:${hint.target ?? ""}`;
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
): {
  title: string;
  summary?: string;
  toolFamily?: string;
} {
  return {
    title,
    ...(summary !== undefined ? { summary } : {}),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
  };
}

function unreachableSourceEvent(event: never): never {
  throw new Error(`Unhandled source event in semantic interpreter: ${JSON.stringify(event)}`);
}

function unreachableRequestKind(kind: never): never {
  throw new Error(`Unhandled human input request kind in semantic interpreter: ${kind}`);
}

function unreachableToolFamilySource(source: never): never {
  throw new Error(`Unhandled tool family provenance source in semantic interpreter: ${source}`);
}
