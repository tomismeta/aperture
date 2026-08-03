import type { SourceEvent } from "@tomismeta/aperture-core";
import { semanticHintsForTruncatedSourceEvidence } from "@tomismeta/aperture-core/semantic";

import {
  clipSourceEventSummary,
  isClippedSourceEventSummary,
  toSingleLine,
} from "./source-event-summary.js";

type SourceTaskUpdate = Extract<SourceEvent, { type: "task.updated" }>;
type SourceTaskUpdateStatus = SourceTaskUpdate["status"];
type SourceTaskUpdateSemanticHints = NonNullable<SourceTaskUpdate["semanticHints"]>;
type SourceTaskUpdateQualityFields = Pick<
  SourceTaskUpdate,
  "metadata" | "semanticHints" | "summary"
>;

export function buildTruncatedSourceEvidenceSemanticHints(
  input: { truncated?: boolean },
  status: SourceTaskUpdateStatus,
): SourceTaskUpdateSemanticHints | undefined {
  return input.truncated === true
    ? semanticHintsForTruncatedSourceEvidence({ status, consequence: false })
    : undefined;
}

export function buildTaskUpdateSourceQualityFields(input: {
  summary?: string | undefined;
  status: SourceTaskUpdateStatus;
  metadata?: Record<string, unknown> | undefined;
  semanticHints?: SourceTaskUpdateSemanticHints | undefined;
  summaryMode?: "raw" | "preserved";
}): SourceTaskUpdateQualityFields {
  const summary = readSourceQualitySummary(input.summary, input.summaryMode ?? "raw");
  const truncated =
    input.metadata?.truncated === true ||
    summaryWasClipped({
      originalSummary: input.summary,
      preparedSummary: summary,
      summaryMode: input.summaryMode ?? "raw",
    });
  const metadata = truncated ? { ...input.metadata, truncated: true } : input.metadata;
  const semanticHints = mergeSemanticHints(
    input.semanticHints,
    truncated
      ? semanticHintsForTruncatedSourceEvidence({
          status: input.status,
          consequence: false,
        })
      : undefined,
  );

  return {
    ...(summary !== undefined ? { summary } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(semanticHints !== undefined ? { semanticHints } : {}),
  };
}

export function sourceEventWithRehydratedSourceQuality(event: SourceEvent): SourceEvent {
  if (event.type !== "task.updated") {
    return event;
  }

  return {
    ...event,
    ...buildTaskUpdateSourceQualityFields({
      summary: event.summary,
      status: event.status,
      metadata: event.metadata,
      semanticHints: event.semanticHints,
      summaryMode: "preserved",
    }),
  };
}

function readSourceQualitySummary(
  summary: string | undefined,
  summaryMode: "raw" | "preserved",
): string | undefined {
  if (summary === undefined) {
    return undefined;
  }
  return summaryMode === "raw" ? clipSourceEventSummary(summary) : summary;
}

function summaryWasClipped(input: {
  originalSummary?: string | undefined;
  preparedSummary?: string | undefined;
  summaryMode: "raw" | "preserved";
}): boolean {
  if (input.originalSummary === undefined || input.preparedSummary === undefined) {
    return false;
  }
  if (input.summaryMode === "preserved") {
    return isClippedSourceEventSummary(input.preparedSummary);
  }
  const normalizedSummary = toSingleLine(input.originalSummary) ?? input.originalSummary;
  return input.preparedSummary !== normalizedSummary;
}

function mergeSemanticHints(
  first: SourceTaskUpdateSemanticHints | undefined,
  second: SourceTaskUpdateSemanticHints | undefined,
): SourceTaskUpdateSemanticHints | undefined {
  if (!first) return second;
  if (!second) return first;

  const consequence = strongerConsequence(first.consequence, second.consequence);
  const confidence = lowerConfidence(first.confidence, second.confidence);

  return {
    ...first,
    ...second,
    ...(consequence !== undefined ? { consequence } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    factors: dedupeStrings([...(first.factors ?? []), ...(second.factors ?? [])]),
    relationHints: [...(first.relationHints ?? []), ...(second.relationHints ?? [])],
    reasons: dedupeStrings([...(first.reasons ?? []), ...(second.reasons ?? [])]),
  };
}

function strongerConsequence(
  first: SourceTaskUpdateSemanticHints["consequence"],
  second: SourceTaskUpdateSemanticHints["consequence"],
): SourceTaskUpdateSemanticHints["consequence"] {
  if (!first) return second;
  if (!second) return first;
  return consequenceWeight(second) > consequenceWeight(first) ? second : first;
}

function consequenceWeight(
  value: NonNullable<SourceTaskUpdateSemanticHints["consequence"]>,
): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function lowerConfidence(
  first: SourceTaskUpdateSemanticHints["confidence"],
  second: SourceTaskUpdateSemanticHints["confidence"],
): SourceTaskUpdateSemanticHints["confidence"] {
  if (!first) return second;
  if (!second) return first;
  return confidenceWeight(second) < confidenceWeight(first) ? second : first;
}

function confidenceWeight(value: NonNullable<SourceTaskUpdateSemanticHints["confidence"]>): number {
  if (value === "low") return 1;
  if (value === "medium") return 2;
  return 3;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
