import type { SourceEvent } from "@tomismeta/aperture-core";
import { assertValidSourceEvent } from "@tomismeta/aperture-core/internal";

import holdoutArtifact from "../conformance/observation-kernel-holdout-v2.json" with { type: "json" };

import type {
  ObservationKernelExpectedFields,
  ObservationKernelExpectedOutcome,
} from "./observation-kernel-expectations.js";
import type { ObservationKernelFixture } from "./observation-kernel-fixtures.js";
import type { ObservationKernelJudgmentFields } from "./observation-kernel-scorecard-model.js";

export const OBSERVATION_KERNEL_HOLDOUT_SCHEMA_VERSION = 2 as const;
export const OBSERVATION_KERNEL_HOLDOUT_CONTRACT_ID =
  "aperture-observation-judgment-contract/v1" as const;
export const OBSERVATION_KERNEL_HOLDOUT_CONTRACT_DIGEST =
  "sha256:9d53456de27a9db5342c98d100971bd3cec6336d2f61b1cef9048e2297ea294e" as const;
export const OBSERVATION_KERNEL_HOLDOUT_IMPLEMENTATION_FREEZE =
  "ca18486a54544a8a154f7c626437f0d803cde933" as const;
export const OBSERVATION_KERNEL_HOLDOUT_FIXTURE_COUNT = 12 as const;

export type ObservationKernelHoldoutArtifact = {
  methodology: {
    schemaVersion: typeof OBSERVATION_KERNEL_HOLDOUT_SCHEMA_VERSION;
    contractId: typeof OBSERVATION_KERNEL_HOLDOUT_CONTRACT_ID;
    contractDigest: typeof OBSERVATION_KERNEL_HOLDOUT_CONTRACT_DIGEST;
    implementationFreeze: typeof OBSERVATION_KERNEL_HOLDOUT_IMPLEMENTATION_FREEZE;
    author: "gpt-5.6-sol";
    authoredWithoutImplementationInspection: true;
    authoredWithoutExecution: true;
    firstExecutionPermittedAfterCommit: true;
    fixtureCount: typeof OBSERVATION_KERNEL_HOLDOUT_FIXTURE_COUNT;
    notes: string[];
  };
  fixtures: Array<
    ObservationKernelFixture & {
      split: "holdout";
      expected: ObservationKernelExpectedOutcome[];
      rationale: string;
    }
  >;
};

export function parseObservationKernelHoldout(value: unknown): ObservationKernelHoldoutArtifact {
  if (!isRecord(value) || !isMethodology(value.methodology) || !Array.isArray(value.fixtures)) {
    throw new Error("Invalid Observation Kernel holdout artifact.");
  }
  const ids = new Set<string>();
  const dimensions = new Set<string>();
  const eventIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const fixture of value.fixtures) {
    if (!isHoldoutFixture(fixture)) {
      throw new Error("Invalid Observation Kernel holdout fixture.");
    }
    if (ids.has(fixture.id) || dimensions.has(fixture.dimension)) {
      throw new Error("Observation Kernel holdout ids and dimensions must be unique.");
    }
    ids.add(fixture.id);
    dimensions.add(fixture.dimension);
    const event = fixture.events[0];
    if (event === undefined || eventIds.has(event.id) || taskIds.has(event.taskId)) {
      throw new Error("Observation Kernel holdout event and task ids must be unique.");
    }
    eventIds.add(event.id);
    taskIds.add(event.taskId);
  }
  if (value.fixtures.length !== OBSERVATION_KERNEL_HOLDOUT_FIXTURE_COUNT) {
    throw new Error(
      `Observation Kernel holdout must contain exactly ${OBSERVATION_KERNEL_HOLDOUT_FIXTURE_COUNT} fixtures.`,
    );
  }
  return value as ObservationKernelHoldoutArtifact;
}

function isMethodology(value: unknown): boolean {
  return (
    hasExactKeys(value, [
      "schemaVersion",
      "contractId",
      "contractDigest",
      "implementationFreeze",
      "author",
      "authoredWithoutImplementationInspection",
      "authoredWithoutExecution",
      "firstExecutionPermittedAfterCommit",
      "fixtureCount",
      "notes",
    ]) &&
    value.schemaVersion === OBSERVATION_KERNEL_HOLDOUT_SCHEMA_VERSION &&
    value.contractId === OBSERVATION_KERNEL_HOLDOUT_CONTRACT_ID &&
    value.contractDigest === OBSERVATION_KERNEL_HOLDOUT_CONTRACT_DIGEST &&
    value.implementationFreeze === OBSERVATION_KERNEL_HOLDOUT_IMPLEMENTATION_FREEZE &&
    value.author === "gpt-5.6-sol" &&
    value.authoredWithoutImplementationInspection === true &&
    value.authoredWithoutExecution === true &&
    value.firstExecutionPermittedAfterCommit === true &&
    value.fixtureCount === OBSERVATION_KERNEL_HOLDOUT_FIXTURE_COUNT &&
    isNonemptyStringArray(value.notes)
  );
}

function isHoldoutFixture(value: unknown): boolean {
  if (
    !hasExactKeys(value, ["id", "dimension", "split", "events", "expected", "rationale"]) ||
    typeof value.id !== "string" ||
    !/^holdout-v2-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) ||
    typeof value.dimension !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.dimension) ||
    value.split !== "holdout" ||
    !Array.isArray(value.events) ||
    value.events.length !== 1 ||
    !Array.isArray(value.expected) ||
    value.expected.length !== 1 ||
    typeof value.rationale !== "string" ||
    value.rationale.length === 0 ||
    !value.expected.every(isExpectedOutcome)
  ) {
    return false;
  }
  try {
    for (const event of value.events) {
      assertValidSourceEvent(event as SourceEvent);
    }
  } catch {
    return false;
  }
  return value.events.every(
    (event) =>
      isRecord(event) &&
      hasOnlyKeys(event, [
        "id",
        "taskId",
        "timestamp",
        "type",
        "title",
        "summary",
        "status",
        "toolFamily",
      ]) &&
      typeof event.id === "string" &&
      /^event-v2-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.id) &&
      typeof event.taskId === "string" &&
      /^task-v2-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.taskId) &&
      event.timestamp === "2026-08-12T12:00:00.000Z" &&
      event.type === "task.updated" &&
      event.status === "failed" &&
      typeof event.title === "string" &&
      event.title.length > 0 &&
      event.title.length <= 240 &&
      typeof event.summary === "string" &&
      event.summary.length > 0 &&
      event.summary.length <= 2_000 &&
      (event.toolFamily === undefined ||
        (typeof event.toolFamily === "string" &&
          /^[a-z][a-z0-9_-]*$/.test(event.toolFamily) &&
          event.toolFamily.length <= 80)),
  );
}

function isExpectedOutcome(value: unknown): boolean {
  return (
    hasExactKeys(value, ["fields", "judgment", "decision"]) &&
    isExpectedFields(value.fields) &&
    isExpectedJudgment(value.judgment) &&
    hasExactKeys(value.decision, ["plannerKind", "resultLane"]) &&
    includes(PLANNER_KINDS, value.decision.plannerKind) &&
    includes(RESULT_LANES, value.decision.resultLane)
  );
}

function isExpectedFields(value: unknown): value is ObservationKernelExpectedFields {
  return (
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
    ]) &&
    includes(OBSERVATION_KINDS, value.kind) &&
    includes(POLARITIES, value.polarity) &&
    includes(OWNERS, value.owner) &&
    isNullableString(value.toolFamily) &&
    includes(SUBJECTS, value.subject) &&
    includes(EVIDENCE_LOSSES, value.evidenceLoss) &&
    includes(EVIDENCE_STRENGTHS, value.evidenceStrength) &&
    includes(SEMANTIC_AGREEMENTS, value.semanticAgreement) &&
    includesNullable(DIAGNOSTIC_CLASSES, value.diagnosticClass) &&
    includesNullable(RECOVERY_HINTS, value.recoveryHint) &&
    includes(PROVENANCE_ORIGINS, value.provenanceOrigin) &&
    includes(PROVENANCE_AUTHORITIES, value.provenanceAuthority) &&
    includes(CONSEQUENCES, value.consequenceBaseline)
  );
}

function isExpectedJudgment(value: unknown): value is ObservationKernelJudgmentFields {
  return (
    hasExactKeys(value, [
      "statusEvidence",
      "statusConflictKind",
      "recoveryPosture",
      "baselineConsequence",
      "outcomeOnlyFailureStatus",
      "limitedFailureStatus",
      "stableStatusEvidence",
      "visibleDiagnosticFailure",
    ]) &&
    includes(STATUS_EVIDENCE, value.statusEvidence) &&
    includesNullable(STATUS_CONFLICT_KINDS, value.statusConflictKind) &&
    includes(RECOVERY_POSTURES, value.recoveryPosture) &&
    includes(CONSEQUENCES, value.baselineConsequence) &&
    typeof value.outcomeOnlyFailureStatus === "boolean" &&
    typeof value.limitedFailureStatus === "boolean" &&
    typeof value.stableStatusEvidence === "boolean" &&
    typeof value.visibleDiagnosticFailure === "boolean"
  );
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonemptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function includes<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function includesNullable<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] | null {
  return value === null || includes(values, value);
}

const OBSERVATION_KINDS = ["control", "diagnostic", "outcome", "payload", "unknown"] as const;
const POLARITIES = ["failure", "neutral", "success", "unknown"] as const;
const OWNERS = ["engine", "source", "tool", "unknown"] as const;
const SUBJECTS = ["command", "document", "search", "source", "tool", "unknown"] as const;
const EVIDENCE_LOSSES = ["absent", "none", "partial", "unknown"] as const;
const EVIDENCE_STRENGTHS = ["weak", "qualified", "strong"] as const;
const SEMANTIC_AGREEMENTS = ["stable", "overridden", "uncertain"] as const;
const DIAGNOSTIC_CLASSES = ["expected", "runtime", "source_limit"] as const;
const RECOVERY_HINTS = [
  "await_authorization",
  "inspect_diagnostic",
  "inspect_original_evidence",
  "narrow_evidence_scope",
  "request_evidence",
] as const;
const PROVENANCE_ORIGINS = [
  "command_output",
  "read_output",
  "semantic_evidence",
  "status_text",
  "structured_output",
  "transcript",
] as const;
const PROVENANCE_AUTHORITIES = ["explicit", "hinted", "inferred", "unknown"] as const;
const CONSEQUENCES = ["low", "medium", "high"] as const;
const STATUS_EVIDENCE = [
  "limited_failure",
  "stable_observation",
  "visible_diagnostic_failure",
  "weak_or_uncertain",
] as const;
const STATUS_CONFLICT_KINDS = [
  "command_success_observation",
  "execution_success_observation",
  "payload_observation",
  "rejected_tool_use_observation",
  "search_output_observation",
  "structured_output_observation",
] as const;
const RECOVERY_POSTURES = [
  "authorization_required",
  "diagnostic_inspection",
  "evidence_required",
  "evidence_scope_required",
  "original_evidence_required",
  "none",
] as const;
const PLANNER_KINDS = [
  "activate",
  "ambient",
  "auto_approve",
  "clear",
  "queue",
  "suppressed",
] as const;
const RESULT_LANES = ["ambient", "next", "none", "now"] as const;

export const OBSERVATION_KERNEL_HOLDOUT = parseObservationKernelHoldout(holdoutArtifact);
export const OBSERVATION_KERNEL_HOLDOUT_FIXTURES: ObservationKernelFixture[] =
  OBSERVATION_KERNEL_HOLDOUT.fixtures.map(
    ({ expected: _expected, rationale: _rationale, ...rest }) => rest,
  );
export const OBSERVATION_KERNEL_HOLDOUT_EXPECTATIONS: Readonly<
  Record<string, readonly ObservationKernelExpectedOutcome[]>
> = Object.fromEntries(
  OBSERVATION_KERNEL_HOLDOUT.fixtures.map((fixture) => [fixture.id, fixture.expected]),
);
