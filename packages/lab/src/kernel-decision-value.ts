import { compareKernelCanonicalKey } from "./kernel-canonical-json.js";
import type { ReplayDecisionRecordTraceProjection } from "./replay-trace.js";

export function readKernelDecisionRecordScore(
  record: ReplayDecisionRecordTraceProjection,
): number | null {
  const value = record.value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(value, "claimScore")) {
    return isFiniteNumber(value.claimScore) ? value.claimScore : null;
  }

  return isFiniteNumber(value.candidateScore) ? value.candidateScore : null;
}

export function readKernelDecisionRecordComponents(
  value: Record<string, unknown>,
): Record<string, number> | null {
  const entries = Object.entries(value);
  if (!entries.every((entry): entry is [string, number] => isFiniteNumber(entry[1]))) {
    return null;
  }

  return Object.fromEntries(
    entries.sort(([left], [right]) => compareKernelCanonicalKey(left, right)),
  );
}

export function sortKernelDecisionRecordComponents(
  value: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => compareKernelCanonicalKey(left, right)),
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
