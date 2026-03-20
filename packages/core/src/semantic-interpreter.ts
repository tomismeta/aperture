import type { SourceEvent } from "./source-event.js";
import type {
  SemanticActivityClass,
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticInterpretation,
  SemanticInterpretationHints,
  SemanticIntentFrame,
  SemanticRequestExplicitness,
} from "./semantic-types.js";
import { inferToolFamily, readExplicitToolFamily } from "./interaction-taxonomy.js";

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
        reasons: ["task start is an explicit lifecycle fact"],
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
        reasons: ["task completion is an explicit lifecycle fact"],
      };
    case "task.cancelled":
      return {
        intentFrame: "cancellation",
        activityClass: "status_update",
        operatorActionRequired: false,
        requestExplicitness: "none",
        consequence: "low",
        ...(event.reason ? { whyNow: "Work was cancelled and may need review." } : {}),
        factors: ["task.cancelled"],
        relationHints: [],
        confidence: "high",
        reasons: ["task cancellation is an explicit lifecycle fact"],
      };
  }
}

function inferTaskUpdateSemantics(
  event: Extract<SourceEvent, { type: "task.updated" }>,
): SemanticInterpretation {
  const text = normalizeText(`${event.title} ${event.summary ?? ""}`);
  const impliedAsk = containsAnyPhrase(text, IMPLIED_OPERATOR_ASKS);
  const taxonomyInput = buildTaxonomyInput(event.title, event.summary, event.toolFamily);
  const toolFamily = readExplicitToolFamily(taxonomyInput) ?? inferToolFamily(taxonomyInput) ?? undefined;

  switch (event.status) {
    case "failed":
      return {
        intentFrame: "failure",
        activityClass: "tool_failure",
        ...(toolFamily ? { toolFamily } : {}),
        operatorActionRequired: true,
        requestExplicitness: impliedAsk ? "implied" : "none",
        consequence: inferConsequenceFromText(text, "high", toolFamily),
        whyNow: "Work has failed and should be reviewed.",
        factors: ["task.updated", "failed"],
        relationHints: [],
        confidence: impliedAsk ? "medium" : "high",
        reasons: ["task status explicitly indicates failure"],
      };
    case "blocked":
      return {
        intentFrame: "blocked_work",
        activityClass: "status_update",
        ...(toolFamily ? { toolFamily } : {}),
        operatorActionRequired: true,
        requestExplicitness: impliedAsk ? "implied" : "none",
        consequence: inferConsequenceFromText(text, "medium", toolFamily),
        whyNow: "Work is blocked and may require operator attention.",
        factors: ["task.updated", "blocked"],
        relationHints: [],
        confidence: impliedAsk ? "medium" : "high",
        reasons: ["task status explicitly indicates blocked work"],
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
        consequence: inferConsequenceFromText(text, "low", toolFamily),
        ...(impliedAsk ? { whyNow: "Status text implies the operator may need to respond." } : {}),
        factors: ["task.updated", event.status],
        relationHints: [],
        confidence: impliedAsk ? "low" : "high",
        reasons: impliedAsk
          ? ["status wording suggests an implied operator request"]
          : ["task update carries a non-blocking lifecycle status"],
      };
  }
}

function inferHumanInputSemantics(
  event: Extract<SourceEvent, { type: "human.input.requested" }>,
): SemanticInterpretation {
  const taxonomyInput = buildTaxonomyInput(event.title, event.summary, event.toolFamily, event.context);
  const toolFamily = readExplicitToolFamily(taxonomyInput) ?? inferToolFamily(taxonomyInput) ?? undefined;
  const text = normalizeText(`${event.title} ${event.summary}`);
  const baseConsequence = event.riskHint ?? consequenceFromRequestKind(event.request.kind, toolFamily);
  const consequence = inferConsequenceFromText(text, baseConsequence, toolFamily);

  return {
    intentFrame: intentFrameForRequestKind(event.request.kind),
    activityClass: activityClassForRequestKind(event.request.kind),
    ...(toolFamily ? { toolFamily } : {}),
    operatorActionRequired: true,
    requestExplicitness: "explicit",
    consequence,
    whyNow: whyNowForRequestKind(event.request.kind, consequence),
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
    factors: dedupeStrings([...(inferred.factors ?? []), ...(hints.factors ?? [])]),
    relationHints: [...(hints.relationHints ?? inferred.relationHints)],
    reasons: dedupeStrings([...(inferred.reasons ?? []), ...(hints.reasons ?? [])]),
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

function intentFrameForRequestKind(kind: "approval" | "choice" | "form"): SemanticIntentFrame {
  switch (kind) {
    case "approval":
      return "approval_request";
    case "choice":
      return "question_request";
    case "form":
      return "form_request";
  }
}

function activityClassForRequestKind(kind: "approval" | "choice" | "form"): SemanticActivityClass {
  switch (kind) {
    case "approval":
      return "permission_request";
    case "choice":
    case "form":
      return "question_request";
  }
}

function whyNowForRequestKind(
  kind: "approval" | "choice" | "form",
  consequence: SemanticConsequenceLevel,
): string {
  switch (kind) {
    case "approval":
      return consequence === "high"
        ? "A high-risk action needs explicit operator approval."
        : "Approval is required before work can continue.";
    case "choice":
      return "A decision is required before work can continue.";
    case "form":
      return "Additional input is required before work can continue.";
  }
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

function inferConsequenceFromText(
  text: string,
  fallback: SemanticConsequenceLevel,
  toolFamily?: string,
): SemanticConsequenceLevel {
  if (containsAnyPhrase(text, HIGH_RISK_PHRASES)) {
    return "high";
  }

  if (toolFamily === "read" || toolFamily === "search") {
    return fallback === "high" ? "high" : "low";
  }

  if (toolFamily === "write" || toolFamily === "edit" || toolFamily === "bash") {
    return fallback === "low" ? "medium" : fallback;
  }

  return fallback;
}

function containsAnyPhrase(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/.-]+/g, " ").trim();
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

const IMPLIED_OPERATOR_ASKS = [
  "need your input",
  "need your approval",
  "waiting for approval",
  "approval required",
  "should i continue",
  "can you approve",
  "what should i do",
  "please review",
] as const;

const HIGH_RISK_PHRASES = [
  "production",
  "prod",
  "force push",
  "git push --force",
  "rm -rf",
  "drop table",
  "delete database",
  "delete prod",
  "sudo",
  "chmod 777",
  "kill process",
  "migrate",
] as const;

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
    items?: Array<{
      id: string;
      label: string;
      value?: string;
    }>;
  };
} {
  return {
    title,
    ...(summary !== undefined ? { summary } : {}),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    ...(context?.items !== undefined ? { context: { items: context.items } } : {}),
  };
}
