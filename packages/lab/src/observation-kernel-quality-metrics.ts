import type { ObservationKernelFixtureSplit } from "./observation-kernel-fixtures.js";
import type {
  ObservationKernelAccuracy,
  ObservationKernelFieldAccuracy,
  ObservationKernelQualityBreakdown,
} from "./observation-kernel-quality.js";

export type ObservationKernelQualityLayer = "decision" | "judgment" | "semantics";
export type ObservationKernelQualityAssertion = {
  split: ObservationKernelFixtureSplit;
  layer: ObservationKernelQualityLayer;
  field: string;
  passed: boolean;
};

export function buildObservationQualityBreakdown(
  assertions: readonly ObservationKernelQualityAssertion[],
  exactOutcomes: ObservationKernelAccuracy,
  split: ObservationKernelFixtureSplit | null,
): ObservationKernelQualityBreakdown {
  const selected =
    split === null ? assertions : assertions.filter((entry) => entry.split === split);
  return {
    semantics: accuracy(selected.filter((entry) => entry.layer === "semantics")),
    judgment: accuracy(selected.filter((entry) => entry.layer === "judgment")),
    decision: accuracy(selected.filter((entry) => entry.layer === "decision")),
    exactOutcomes: normalizeAccuracy(exactOutcomes),
  };
}

export function buildObservationFieldAccuracy(
  assertions: readonly ObservationKernelQualityAssertion[],
  layer: ObservationKernelQualityLayer,
): ObservationKernelFieldAccuracy[] {
  const fields = new Map<string, ObservationKernelQualityAssertion[]>();
  for (const assertion of assertions.filter((entry) => entry.layer === layer)) {
    fields.set(assertion.field, [...(fields.get(assertion.field) ?? []), assertion]);
  }
  return [...fields.entries()]
    .map(([field, entries]) => ({ field, ...accuracy(entries) }))
    .sort((left, right) => left.field.localeCompare(right.field));
}

export function combineObservationAccuracy(
  counts: Record<ObservationKernelFixtureSplit, ObservationKernelAccuracy>,
): ObservationKernelAccuracy {
  return {
    passed: counts.calibration.passed + counts.holdout.passed,
    total: counts.calibration.total + counts.holdout.total,
    score: 1,
  };
}

function accuracy(entries: readonly { passed: boolean }[]): ObservationKernelAccuracy {
  const passed = entries.filter((entry) => entry.passed).length;
  return {
    passed,
    total: entries.length,
    score: entries.length === 0 ? 0 : passed / entries.length,
  };
}

function normalizeAccuracy(entries: ObservationKernelAccuracy): ObservationKernelAccuracy {
  return {
    passed: entries.passed,
    total: entries.total,
    score: entries.total === 0 ? 0 : entries.passed / entries.total,
  };
}
