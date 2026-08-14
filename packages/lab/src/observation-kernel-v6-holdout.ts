import { writeFile } from "node:fs/promises";

import { ApertureCore } from "@tomismeta/aperture-core";
import {
  isCandidateTrace,
  judgeObservation,
  subscribeInternalTrace,
  type ApertureTrace,
} from "@tomismeta/aperture-core/internal";
import type { SourceEvent } from "@tomismeta/aperture-core";
import { assertValidSourceEvent } from "@tomismeta/aperture-core/internal";
import { normalizeSourceEvent } from "@tomismeta/aperture-core/semantic";
import holdoutArtifact from "../conformance/observation-kernel-holdout-v6.json" with { type: "json" };

import {
  compareKernelCanonicalKey,
  digestKernelCanonicalJson,
  serializeKernelCanonicalJson,
} from "./kernel-canonical-json.js";
import type {
  ObservationKernelDecisionFields,
  ObservationKernelFields,
  ObservationKernelObservation,
} from "./observation-kernel-scorecard.js";
import type { ObservationKernelExpectedOutcome } from "./observation-kernel-expectations.js";

const HOLDOUT_SCHEMA_VERSION = 6 as const;
const IMPLEMENTATION_FREEZE = "a3d36b5571494e43ffee98ceb38fddea43155553" as const;
const FIXTURE_COUNT = 24 as const;
const TYPED_FIXTURE_COUNT = 12 as const;
const FALLBACK_FIXTURE_COUNT = 12 as const;

type V6Event = Extract<SourceEvent, { type: "task.updated" }> & { status: "failed" };

type V6Fixture = {
  id: string;
  dimension: string;
  split: "holdout";
  events: V6Event[];
  expected: ObservationKernelExpectedOutcome[];
  rationale: string;
};

type V6Artifact = {
  methodology: {
    schemaVersion: 6;
    implementationFreeze: typeof IMPLEMENTATION_FREEZE;
    author: "gpt-5.6-sol";
    authoredWithoutImplementationInspection: true;
    authoredWithoutExecution: true;
    firstExecutionPermittedAfterCommit: true;
    authoredWithoutPriorOracleInspection: true;
    authoredWithoutCalibrationInspection: true;
    fixtureCount: 24;
    typedEvidenceFixtureCount: 12;
    structuralFallbackFixtureCount: 12;
    [key: string]: unknown;
  };
  fixtures: V6Fixture[];
};

export type ObservationKernelV6HoldoutReport = {
  schemaVersion: 1;
  profile: "observation-kernel-independent-post-freeze-holdout";
  holdoutSchemaVersion: 6;
  implementationFreeze: typeof IMPLEMENTATION_FREEZE;
  holdoutDigest: string;
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
      typed: {
        semanticFields: { passed: number; total: number };
        judgmentFields: { passed: number; total: number };
        decisionFields: { passed: number; total: number };
        exactOutcomes: { passed: number; total: number };
      };
      fallback: {
        semanticFields: { passed: number; total: number };
        judgmentFields: { passed: number; total: number };
        decisionFields: { passed: number; total: number };
        exactOutcomes: { passed: number; total: number };
      };
    };
  };
  observations: ObservationKernelObservation[];
};

export type ObservationKernelV6HoldoutRun = {
  schemaVersion: 1;
  profile: "observation-kernel-independent-post-freeze-holdout-first-run";
  holdoutSchemaVersion: 6;
  implementationFreeze: typeof IMPLEMENTATION_FREEZE;
  holdoutDigest: string;
  observations: ObservationKernelObservation[];
};

export function parseObservationKernelV6Holdout(value: unknown): V6Artifact {
  if (!isRecord(value) || !isRecord(value.methodology) || !Array.isArray(value.fixtures)) {
    throw new Error("Invalid Observation Kernel V6 holdout artifact.");
  }
  const methodology = value.methodology;
  if (
    methodology.schemaVersion !== HOLDOUT_SCHEMA_VERSION ||
    methodology.implementationFreeze !== IMPLEMENTATION_FREEZE ||
    methodology.author !== "gpt-5.6-sol" ||
    methodology.authoredWithoutImplementationInspection !== true ||
    methodology.authoredWithoutExecution !== true ||
    methodology.firstExecutionPermittedAfterCommit !== true ||
    methodology.authoredWithoutPriorOracleInspection !== true ||
    methodology.authoredWithoutCalibrationInspection !== true ||
    methodology.fixtureCount !== FIXTURE_COUNT ||
    methodology.typedEvidenceFixtureCount !== TYPED_FIXTURE_COUNT ||
    methodology.structuralFallbackFixtureCount !== FALLBACK_FIXTURE_COUNT ||
    !Array.isArray(methodology.notes) ||
    methodology.notes.length === 0 ||
    !methodology.notes.every((note) => typeof note === "string" && note.length > 0)
  ) {
    throw new Error("Observation Kernel V6 methodology does not match the frozen protocol.");
  }

  const ids = new Set<string>();
  const dimensions = new Set<string>();
  const eventIds = new Set<string>();
  const taskIds = new Set<string>();
  let typedCount = 0;
  for (const fixture of value.fixtures) {
    if (!isV6Fixture(fixture)) {
      throw new Error("Invalid Observation Kernel V6 fixture.");
    }
    const event = fixture.events[0];
    if (
      event === undefined ||
      ids.has(fixture.id) ||
      dimensions.has(fixture.dimension) ||
      eventIds.has(event.id) ||
      taskIds.has(event.taskId)
    ) {
      throw new Error("Observation Kernel V6 ids, dimensions, events, and tasks must be unique.");
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
    throw new Error("Observation Kernel V6 fixture counts do not match the frozen protocol.");
  }
  return value as V6Artifact;
}

export function runObservationKernelV6Holdout(): ObservationKernelV6HoldoutRun {
  const artifact = parseObservationKernelV6Holdout(holdoutArtifact);
  return {
    schemaVersion: 1,
    profile: "observation-kernel-independent-post-freeze-holdout-first-run",
    holdoutSchemaVersion: HOLDOUT_SCHEMA_VERSION,
    implementationFreeze: IMPLEMENTATION_FREEZE,
    holdoutDigest: digestKernelCanonicalJson(artifact),
    observations: artifact.fixtures.flatMap((fixture) => runFixture(fixture)),
  };
}

export function buildObservationKernelV6HoldoutReport(
  firstRun: ObservationKernelV6HoldoutRun,
  repeatRun: ObservationKernelV6HoldoutRun,
): ObservationKernelV6HoldoutReport {
  const artifact = parseObservationKernelV6Holdout(holdoutArtifact);
  const failures: string[] = [];
  const first = firstRun.observations;
  const repeat = repeatRun.observations;
  if (firstRun.holdoutDigest !== repeatRun.holdoutDigest) {
    failures.push("observation_kernel_v6:holdout_digest_changed_between_runs");
  }
  const stable = digestList(first) === digestList(repeat);
  if (!stable) failures.push("observation_kernel_v6:non_deterministic_observations");

  let exactPassed = 0;
  let exactTotal = 0;
  const byEvidence = {
    typed: createEvidenceCounts(),
    fallback: createEvidenceCounts(),
  };
  for (const fixture of artifact.fixtures) {
    const actual = first.filter((observation) => observation.fixtureId === fixture.id);
    const expected = fixture.expected;
    const event = fixture.events[0];
    if (event === undefined) {
      throw new Error(`Observation Kernel V6 fixture has no event: ${fixture.id}`);
    }
    const evidenceCounts = event.evidence === undefined ? byEvidence.fallback : byEvidence.typed;
    exactTotal += Math.max(actual.length, expected.length);
    evidenceCounts.exactOutcomes.total += Math.max(actual.length, expected.length);
    if (actual.length !== expected.length) {
      failures.push(
        `observation_kernel_v6:outcome_count:${fixture.id}:${actual.length}!=${expected.length}`,
      );
    }
    for (let index = 0; index < Math.max(actual.length, expected.length); index += 1) {
      const actualOutcome = actual[index];
      const expectedOutcome = expected[index];
      if (actualOutcome === undefined || expectedOutcome === undefined) continue;
      const mismatchCount = compareOutcome(
        fixture.id,
        index,
        actualOutcome,
        expectedOutcome,
        failures,
      );
      if (mismatchCount === 0) {
        exactPassed += 1;
        evidenceCounts.exactOutcomes.passed += 1;
      }
      const semanticTotal = Object.keys(expectedOutcome.fields).length;
      const judgmentTotal = Object.keys(expectedOutcome.judgment).length;
      const decisionTotal = Object.keys(expectedOutcome.decision).length;
      evidenceCounts.semanticFields.total += semanticTotal;
      evidenceCounts.judgmentFields.total += judgmentTotal;
      evidenceCounts.decisionFields.total += decisionTotal;
      evidenceCounts.semanticFields.passed += countMatchingFields(
        actualOutcome.fields,
        expectedOutcome.fields,
      );
      evidenceCounts.judgmentFields.passed += countMatchingFields(
        actualOutcome.judgment,
        expectedOutcome.judgment,
      );
      evidenceCounts.decisionFields.passed += countMatchingFields(
        actualOutcome.decision,
        expectedOutcome.decision,
      );
    }
  }
  if (exactPassed !== exactTotal) failures.push("observation_kernel_v6:exact_outcome_mismatch");

  return {
    schemaVersion: 1,
    profile: "observation-kernel-independent-post-freeze-holdout",
    holdoutSchemaVersion: HOLDOUT_SCHEMA_VERSION,
    implementationFreeze: IMPLEMENTATION_FREEZE,
    holdoutDigest: digestKernelCanonicalJson(artifact),
    passed: failures.length === 0,
    failures,
    summary: {
      fixtures: artifact.fixtures.length,
      typedEvidenceFixtures: TYPED_FIXTURE_COUNT,
      structuralFallbackFixtures: FALLBACK_FIXTURE_COUNT,
      observations: first.length,
      determinism: { repeatedRuns: 2, stable },
      exactOutcomes: { passed: exactPassed, total: exactTotal },
      byEvidence,
    },
    observations: first.sort(
      (left, right) =>
        compareKernelCanonicalKey(left.fixtureId, right.fixtureId) ||
        left.sequence - right.sequence,
    ),
  };
}

type EvidenceCounts = {
  semanticFields: { passed: number; total: number };
  judgmentFields: { passed: number; total: number };
  decisionFields: { passed: number; total: number };
  exactOutcomes: { passed: number; total: number };
};

function createEvidenceCounts(): EvidenceCounts {
  return {
    semanticFields: { passed: 0, total: 0 },
    judgmentFields: { passed: 0, total: 0 },
    decisionFields: { passed: 0, total: 0 },
    exactOutcomes: { passed: 0, total: 0 },
  };
}

function countMatchingFields(actual: object, expected: object): number {
  return Object.entries(expected).filter(
    ([field, value]) => (actual as Record<string, unknown>)[field] === value,
  ).length;
}

export async function writeObservationKernelV6HoldoutReport(
  report: ObservationKernelV6HoldoutReport | ObservationKernelV6HoldoutRun,
  path: string,
): Promise<void> {
  await writeFile(path, `${serializeKernelCanonicalJson(report)}\n`, "utf8");
}

function runFixture(fixture: V6Fixture): ObservationKernelObservation[] {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];
  subscribeInternalTrace(core, (trace) => traces.push(trace));
  for (const event of fixture.events) core.publish(normalizeSourceEvent(event));

  let sequence = 0;
  return traces.flatMap((trace) => {
    if (!isCandidateTrace(trace)) return [];
    const observation = trace.evaluation.adjusted.judgmentInput.observation;
    if (observation === undefined) return [];
    const fields: ObservationKernelFields = {
      kind: observation.kind,
      polarity: observation.polarity,
      owner: observation.ownership.owner,
      toolFamily: observation.ownership.capabilityFamily ?? null,
      subject: observation.subject,
      evidenceLoss: observation.evidenceLoss,
      evidenceStrength: observation.evidenceStrength,
      semanticAgreement: observation.semanticAgreement,
      diagnosticClass: observation.diagnosticClass ?? null,
      recoveryHint: observation.recoveryHint ?? null,
      provenanceOrigin: observation.provenance.origin,
      provenanceAuthority: observation.provenance.authority,
      consequenceBaseline: observation.consequenceBaseline,
    };
    const judgment = judgeObservation(observation);
    const decision: ObservationKernelDecisionFields = {
      plannerKind: trace.coordination.kind,
      resultLane: trace.coordination.resultLane,
    };
    const currentSequence = sequence++;
    return [
      {
        fixtureId: fixture.id,
        dimension: fixture.dimension,
        split: fixture.split,
        sequence: currentSequence,
        digest: digestKernelCanonicalJson({ fixtureId: fixture.id, fields, judgment, decision }),
        semanticDigest: digestKernelCanonicalJson(fields),
        judgmentDigest: digestKernelCanonicalJson(judgment),
        decisionDigest: digestKernelCanonicalJson(decision),
        fields,
        judgment,
        decision,
      },
    ];
  });
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
        `observation_kernel_v6:mismatch:${fixtureId}:${sequence}:${layer}:${field}:${String((actualValue as Record<string, unknown>)[field])}!=${String(value)}`,
      );
    }
  }
  return mismatches;
}

function digestList(observations: readonly ObservationKernelObservation[]): string {
  return observations
    .map((observation) => `${observation.fixtureId}:${observation.digest}`)
    .sort(compareKernelCanonicalKey)
    .join("\n");
}

function isV6Fixture(value: unknown): value is V6Fixture {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "dimension", "split", "events", "expected", "rationale"]) ||
    typeof value.id !== "string" ||
    !/^holdout-v6-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) ||
    typeof value.dimension !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.dimension) ||
    value.split !== "holdout" ||
    !Array.isArray(value.events) ||
    value.events.length !== 1 ||
    !Array.isArray(value.expected) ||
    value.expected.length !== 1 ||
    typeof value.rationale !== "string" ||
    value.rationale.length === 0
  ) {
    return false;
  }
  const event = value.events[0];
  if (
    !isRecord(event) ||
    !hasOnlyKeys(event, [
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
    ]) ||
    typeof event.id !== "string" ||
    !/^event-v6-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.id) ||
    typeof event.taskId !== "string" ||
    !/^task-v6-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.taskId) ||
    typeof event.timestamp !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.timestamp) ||
    Number.isNaN(Date.parse(event.timestamp)) ||
    event.type !== "task.updated" ||
    event.status !== "failed" ||
    typeof event.title !== "string" ||
    event.title.length === 0 ||
    event.title.length > 240 ||
    typeof event.summary !== "string" ||
    event.summary.length === 0 ||
    event.summary.length > 2000
  ) {
    return false;
  }
  try {
    assertValidSourceEvent(event as SourceEvent);
  } catch {
    return false;
  }
  return isExpectedOutcome(value.expected[0]);
}

function isExpectedOutcome(value: unknown): value is ObservationKernelExpectedOutcome {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["fields", "judgment", "decision"]) ||
    !isRecord(value.fields) ||
    !isRecord(value.judgment) ||
    !isRecord(value.decision) ||
    !hasExactKeys(value.fields, EXPECTED_FIELD_KEYS) ||
    !hasExactKeys(value.judgment, EXPECTED_JUDGMENT_KEYS) ||
    !hasExactKeys(value.decision, ["plannerKind", "resultLane"])
  ) {
    return false;
  }
  return (
    isNonemptyStringRecord(value.fields) &&
    isNonemptyStringRecord(value.judgment) &&
    typeof value.decision.plannerKind === "string" &&
    typeof value.decision.resultLane === "string"
  );
}

const EXPECTED_FIELD_KEYS = [
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
] as const;

const EXPECTED_JUDGMENT_KEYS = [
  "statusEvidence",
  "statusConflictKind",
  "recoveryPosture",
  "baselineConsequence",
  "outcomeOnlyFailureStatus",
  "limitedFailureStatus",
  "stableStatusEvidence",
  "visibleDiagnosticFailure",
] as const;

function isNonemptyStringRecord(value: Record<string, unknown>): boolean {
  return Object.values(value).every(
    (entry) => entry === null || typeof entry === "string" || typeof entry === "boolean",
  );
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
