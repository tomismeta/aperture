import type { SourceEvent } from "@tomismeta/aperture-core";
import { assertValidSourceEvent } from "@tomismeta/aperture-core/internal";

import releaseHoldoutArtifact from "../conformance/observation-kernel-release-holdout.json" with { type: "json" };

import {
  digestObservationKernelList,
  evaluateObservationKernelFixture,
} from "./observation-kernel-evaluator.js";
import type { ObservationKernelFixture } from "./observation-kernel-fixtures.js";
import {
  digestKernelCanonicalJson,
  serializeKernelCanonicalJson,
} from "./kernel-canonical-json.js";
import type {
  ObservationKernelExpectedOutcome,
  ObservationKernelExpectedFields,
} from "./observation-kernel-expectations.js";
import type { ObservationKernelObservation } from "./observation-kernel-scorecard.js";

export const OBSERVATION_KERNEL_RELEASE_HOLDOUT_PATH =
  "packages/lab/conformance/observation-kernel-release-holdout.json" as const;
export const OBSERVATION_KERNEL_RELEASE_HOLDOUT_FIRST_RUN_PATH =
  "packages/lab/conformance/observation-kernel-release-holdout-first-run.json" as const;
export const OBSERVATION_KERNEL_RELEASE_HOLDOUT_REPORT_PATH =
  "packages/lab/conformance/observation-kernel-release-holdout-report.json" as const;
export const OBSERVATION_KERNEL_RELEASE_HOLDOUT_CUSTODY_PATH =
  "packages/lab/conformance/observation-kernel-release-holdout-custody.json" as const;
export const OBSERVATION_KERNEL_RELEASE_HOLDOUT_EVIDENCE_CUSTODY_PATH =
  "packages/lab/conformance/observation-kernel-release-holdout-evidence-custody.json" as const;

const RELEASE_HOLDOUT_SCHEMA_VERSION = 1 as const;
const FIXTURE_COUNT = 47 as const;
const TYPED_FIXTURE_COUNT = 12 as const;
const FALLBACK_FIXTURE_COUNT = 35 as const;

type ReleaseHoldoutEvent = Extract<SourceEvent, { type: "task.updated" }> & { status: "failed" };

type ReleaseHoldoutFixture = Omit<ObservationKernelFixture, "events"> & {
  events: [ReleaseHoldoutEvent];
  expected: [ObservationKernelExpectedOutcome];
  rationale: string;
};

type ReleaseHoldoutArtifact = {
  methodology: {
    schemaVersion: 1;
    artifactKind: "release_holdout";
    holdoutId: string;
    releaseTarget: string;
    observationContractId: string;
    observationContractDigest: string;
    sourceEvidenceContractId: string;
    sourceEvidenceContractDigest: string;
    outputContractId: string;
    outputContractDigest: string;
    implementationFreeze: string;
    fixtureCount: 47;
    typedEvidenceFixtureCount: 12;
    structuralFallbackFixtureCount: 35;
    oracleProvenance: {
      author: string;
      authoredWithoutExecution: boolean;
      authoredWithoutImplementationInspection: boolean;
      authoredWithoutPriorOracleInspection: boolean;
      authoredWithoutCalibrationInspection: boolean;
      notes: string[];
    };
    notes: string[];
  };
  fixtures: ReleaseHoldoutFixture[];
};

export type ObservationKernelReleaseHoldoutRun = {
  schemaVersion: 1;
  profile: "observation-kernel-release-holdout-first-run";
  holdoutId: string;
  implementationFreeze: string;
  artifactDigest: string;
  observations: ObservationKernelObservation[];
};

export type ObservationKernelReleaseHoldoutReport = {
  schemaVersion: 1;
  profile: "observation-kernel-release-holdout-report";
  holdoutId: string;
  implementationFreeze: string;
  artifactDigest: string;
  passed: boolean;
  failures: string[];
  summary: {
    fixtures: number;
    typedEvidenceFixtures: number;
    structuralFallbackFixtures: number;
    observations: number;
    determinism: { repeatedRuns: 2; stable: boolean };
    exactOutcomes: { passed: number; total: number };
    byEvidence: {
      typed: { passed: number; total: number };
      fallback: { passed: number; total: number };
    };
  };
  observations: ObservationKernelObservation[];
};

export function parseObservationKernelReleaseHoldout(
  value: unknown = releaseHoldoutArtifact,
): ReleaseHoldoutArtifact {
  if (!isRecord(value) || !isRecord(value.methodology) || !Array.isArray(value.fixtures)) {
    throw new Error("Invalid Observation Kernel release holdout artifact.");
  }
  const methodology = value.methodology;
  if (
    methodology.schemaVersion !== RELEASE_HOLDOUT_SCHEMA_VERSION ||
    methodology.artifactKind !== "release_holdout" ||
    typeof methodology.holdoutId !== "string" ||
    methodology.holdoutId.length === 0 ||
    typeof methodology.releaseTarget !== "string" ||
    methodology.releaseTarget.length === 0 ||
    typeof methodology.implementationFreeze !== "string" ||
    !/^[0-9a-f]{40}$/.test(methodology.implementationFreeze) ||
    methodology.fixtureCount !== FIXTURE_COUNT ||
    methodology.typedEvidenceFixtureCount !== TYPED_FIXTURE_COUNT ||
    methodology.structuralFallbackFixtureCount !== FALLBACK_FIXTURE_COUNT ||
    !isRecord(methodology.oracleProvenance) ||
    !isNonemptyStringArray(methodology.notes)
  ) {
    throw new Error("Observation Kernel release holdout methodology is invalid.");
  }

  const ids = new Set<string>();
  const dimensions = new Set<string>();
  const eventIds = new Set<string>();
  const taskIds = new Set<string>();
  let typedCount = 0;
  for (const fixture of value.fixtures) {
    if (!isReleaseHoldoutFixture(fixture)) {
      throw new Error("Invalid Observation Kernel release holdout fixture.");
    }
    const event = fixture.events[0];
    if (
      event === undefined ||
      ids.has(fixture.id) ||
      dimensions.has(fixture.dimension) ||
      eventIds.has(event.id) ||
      taskIds.has(event.taskId)
    ) {
      throw new Error("Observation Kernel release holdout identifiers must be unique.");
    }
    ids.add(fixture.id);
    dimensions.add(fixture.dimension);
    eventIds.add(event.id);
    taskIds.add(event.taskId);
    if (event.evidence !== undefined) typedCount += 1;
  }
  if (
    value.fixtures.length !== FIXTURE_COUNT ||
    typedCount !== TYPED_FIXTURE_COUNT ||
    value.fixtures.length - typedCount !== FALLBACK_FIXTURE_COUNT
  ) {
    throw new Error("Observation Kernel release holdout fixture counts are invalid.");
  }
  return value as ReleaseHoldoutArtifact;
}

export function runObservationKernelReleaseHoldout(): ObservationKernelReleaseHoldoutRun {
  const artifact = parseObservationKernelReleaseHoldout();
  return {
    schemaVersion: RELEASE_HOLDOUT_SCHEMA_VERSION,
    profile: "observation-kernel-release-holdout-first-run",
    holdoutId: artifact.methodology.holdoutId,
    implementationFreeze: artifact.methodology.implementationFreeze,
    artifactDigest: digestKernelCanonicalJson(artifact),
    observations: artifact.fixtures.flatMap((fixture) => evaluateObservationKernelFixture(fixture)),
  };
}

export function buildObservationKernelReleaseHoldoutReport(
  firstRun: ObservationKernelReleaseHoldoutRun,
  repeatRun: ObservationKernelReleaseHoldoutRun,
): ObservationKernelReleaseHoldoutReport {
  const artifact = parseObservationKernelReleaseHoldout();
  const failures: string[] = [];
  const stable =
    digestObservationKernelList(firstRun.observations) ===
    digestObservationKernelList(repeatRun.observations);
  if (!stable) failures.push("observation_kernel_release_holdout:non_deterministic_observations");
  if (firstRun.artifactDigest !== repeatRun.artifactDigest) {
    failures.push("observation_kernel_release_holdout:artifact_digest_changed");
  }

  let exactPassed = 0;
  let exactTotal = 0;
  const byEvidence = {
    typed: { passed: 0, total: 0 },
    fallback: { passed: 0, total: 0 },
  };
  for (const fixture of artifact.fixtures) {
    const actual = firstRun.observations.filter(
      (observation) => observation.fixtureId === fixture.id,
    );
    const expected = fixture.expected;
    const evidenceCounts =
      fixture.events[0]?.evidence === undefined ? byEvidence.fallback : byEvidence.typed;
    exactTotal += Math.max(actual.length, expected.length);
    evidenceCounts.total += Math.max(actual.length, expected.length);
    if (actual.length !== expected.length) {
      failures.push(
        `observation_kernel_release_holdout:outcome_count:${fixture.id}:${actual.length}!=${expected.length}`,
      );
    }
    for (let index = 0; index < Math.max(actual.length, expected.length); index += 1) {
      const actualOutcome = actual[index];
      const expectedOutcome = expected[index];
      if (actualOutcome === undefined || expectedOutcome === undefined) continue;
      const mismatches = compareOutcome(
        fixture.id,
        index,
        actualOutcome,
        expectedOutcome,
        failures,
      );
      if (mismatches === 0) {
        exactPassed += 1;
        evidenceCounts.passed += 1;
      }
    }
  }
  if (exactPassed !== exactTotal) {
    failures.push("observation_kernel_release_holdout:exact_outcome_mismatch");
  }

  return {
    schemaVersion: RELEASE_HOLDOUT_SCHEMA_VERSION,
    profile: "observation-kernel-release-holdout-report",
    holdoutId: artifact.methodology.holdoutId,
    implementationFreeze: artifact.methodology.implementationFreeze,
    artifactDigest: digestKernelCanonicalJson(artifact),
    passed: failures.length === 0,
    failures,
    summary: {
      fixtures: artifact.fixtures.length,
      typedEvidenceFixtures: TYPED_FIXTURE_COUNT,
      structuralFallbackFixtures: FALLBACK_FIXTURE_COUNT,
      observations: firstRun.observations.length,
      determinism: { repeatedRuns: 2, stable },
      exactOutcomes: { passed: exactPassed, total: exactTotal },
      byEvidence,
    },
    observations: [...firstRun.observations].sort(
      (left, right) =>
        left.fixtureId.localeCompare(right.fixtureId) || left.sequence - right.sequence,
    ),
  };
}

export function serializeObservationKernelReleaseHoldout(value: unknown): string {
  return `${serializeKernelCanonicalJson(value)}\n`;
}

function compareOutcome(
  fixtureId: string,
  sequence: number,
  actual: ObservationKernelObservation,
  expected: ObservationKernelExpectedOutcome,
  failures: string[],
): number {
  let mismatches = 0;
  for (const [layer, expectedValue, actualValue] of [
    ["semantics", expected.fields, actual.fields],
    ["judgment", expected.judgment, actual.judgment],
    ["decision", expected.decision, actual.decision],
  ] as const) {
    for (const [field, value] of Object.entries(expectedValue)) {
      if ((actualValue as Record<string, unknown>)[field] === value) continue;
      mismatches += 1;
      failures.push(
        `observation_kernel_release_holdout:mismatch:${fixtureId}:${sequence}:${layer}:${field}:${String((actualValue as Record<string, unknown>)[field])}!=${String(value)}`,
      );
    }
  }
  return mismatches;
}

function isReleaseHoldoutFixture(value: unknown): value is ReleaseHoldoutFixture {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "dimension", "split", "events", "expected", "rationale"]) ||
    typeof value.id !== "string" ||
    !/^holdout-release-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) ||
    typeof value.dimension !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.dimension) ||
    value.split !== "holdout" ||
    !Array.isArray(value.events) ||
    value.events.length !== 1 ||
    !Array.isArray(value.expected) ||
    value.expected.length !== 1 ||
    typeof value.rationale !== "string" ||
    value.rationale.length === 0 ||
    !isExpectedOutcome(value.expected[0])
  ) {
    return false;
  }
  const event = value.events[0];
  if (!isRecord(event)) return false;
  try {
    assertValidSourceEvent(event as SourceEvent);
  } catch {
    return false;
  }
  return (
    hasOnlyKeys(event, [
      "id",
      "taskId",
      "timestamp",
      "type",
      "title",
      "summary",
      "status",
      "toolFamily",
      "metadata",
      "evidence",
      "semanticHints",
    ]) &&
    typeof event.id === "string" &&
    /^event-release-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.id) &&
    typeof event.taskId === "string" &&
    /^task-release-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.taskId) &&
    typeof event.timestamp === "string" &&
    event.type === "task.updated" &&
    event.status === "failed" &&
    typeof event.title === "string" &&
    event.title.length > 0 &&
    event.title.length <= 240 &&
    typeof event.summary === "string" &&
    event.summary.length > 0 &&
    event.summary.length <= 2_000
  );
}

function isExpectedOutcome(value: unknown): value is ObservationKernelExpectedOutcome {
  if (!isRecord(value) || !hasExactKeys(value, ["fields", "judgment", "decision"])) return false;
  return isExpectedFields(value.fields) && isRecord(value.judgment) && isRecord(value.decision);
}

function isExpectedFields(value: unknown): value is ObservationKernelExpectedFields {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "kind",
      "polarity",
      "owner",
      "toolFamily",
      "subject",
      "evidenceLoss",
      "evidenceStrength",
      "semanticAgreement",
      "diagnosticClass",
      "recoveryHint",
      "provenanceOrigin",
      "provenanceAuthority",
      "consequenceBaseline",
    ])
  );
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isNonemptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
