import { ApertureCore } from "@tomismeta/aperture-core";
import {
  isCandidateTrace,
  projectObservationJudgmentContract,
  subscribeInternalTrace,
  type ApertureTrace,
} from "@tomismeta/aperture-core/internal";
import { normalizeSourceEvent } from "@tomismeta/aperture-core/semantic";

import { compareKernelCanonicalKey, digestKernelCanonicalJson } from "./kernel-canonical-json.js";
import { OBSERVATION_KERNEL_EXPECTATIONS } from "./observation-kernel-expectations.js";
import {
  OBSERVATION_KERNEL_FIXTURES,
  type ObservationKernelFixture,
} from "./observation-kernel-fixtures.js";
import { evaluateObservationKernelQuality } from "./observation-kernel-quality.js";
import {
  OBSERVATION_KERNEL_SCORECARD_PROFILE_ID,
  OBSERVATION_KERNEL_SCORECARD_PROFILE_VERSION,
  OBSERVATION_KERNEL_SCORECARD_SCHEMA_VERSION,
  OBSERVATION_KERNEL_SCORECARD_THRESHOLDS,
  type ObservationKernelCoverage,
  type ObservationKernelDecisionFields,
  type ObservationKernelDistribution,
  type ObservationKernelFields,
  type ObservationKernelObservation,
  type ObservationKernelScorecard,
} from "./observation-kernel-scorecard-model.js";

export {
  OBSERVATION_KERNEL_SCORECARD_PROFILE_ID,
  OBSERVATION_KERNEL_SCORECARD_PROFILE_VERSION,
  OBSERVATION_KERNEL_SCORECARD_SCHEMA_VERSION,
  OBSERVATION_KERNEL_SCORECARD_THRESHOLDS,
  type ObservationKernelCoverage,
  type ObservationKernelDecisionFields,
  type ObservationKernelDistribution,
  type ObservationKernelFields,
  type ObservationKernelJudgmentFields,
  type ObservationKernelObservation,
  type ObservationKernelScorecard,
} from "./observation-kernel-scorecard-model.js";

type ObservationAccumulator = Map<string, { count: number; fixtureIds: Set<string> }>;

export function buildObservationKernelScorecard(): ObservationKernelScorecard {
  const failures: string[] = [];
  const observations: ObservationKernelObservation[] = [];
  const repeatObservations: ObservationKernelObservation[] = [];

  for (const fixture of OBSERVATION_KERNEL_FIXTURES) {
    const first = runObservationKernelFixture(fixture);
    const repeat = runObservationKernelFixture(fixture);
    if (first.length === 0) {
      failures.push(`observation_kernel:missing_observation:${fixture.id}`);
    }
    observations.push(...first);
    repeatObservations.push(...repeat);
  }

  const stable =
    readObservationDigestList(observations) === readObservationDigestList(repeatObservations);
  if (!stable) {
    failures.push("observation_kernel:non_deterministic_observations");
  }

  const uniqueSemanticDigests = new Set(
    observations.map((observation) => observation.semanticDigest),
  );
  const coveredDimensions = new Set(observations.map((observation) => observation.dimension));
  const missingDimensions = OBSERVATION_KERNEL_FIXTURES.map((fixture) => fixture.dimension).filter(
    (dimension) => !coveredDimensions.has(dimension),
  );
  const coverage = buildObservationKernelCoverage(observations);
  const quality = evaluateObservationKernelQuality(observations);

  failures.push(
    ...collectThresholdFailures({
      observations,
      uniqueSemanticDigests,
      coveredDimensions,
      missingDimensions,
    }),
    ...quality.failures,
  );

  return {
    schemaVersion: OBSERVATION_KERNEL_SCORECARD_SCHEMA_VERSION,
    profile: {
      id: OBSERVATION_KERNEL_SCORECARD_PROFILE_ID,
      version: OBSERVATION_KERNEL_SCORECARD_PROFILE_VERSION,
      suiteDigest: digestKernelCanonicalJson({
        fixtures: OBSERVATION_KERNEL_FIXTURES.map((fixture) => ({
          id: fixture.id,
          dimension: fixture.dimension,
          split: fixture.split,
          events: fixture.events,
        })),
        expectations: OBSERVATION_KERNEL_EXPECTATIONS,
      }),
    },
    thresholds: OBSERVATION_KERNEL_SCORECARD_THRESHOLDS,
    passed: failures.length === 0,
    failures,
    summary: {
      fixtures: {
        total: OBSERVATION_KERNEL_FIXTURES.length,
        withObservation: new Set(observations.map((observation) => observation.fixtureId)).size,
        calibration: OBSERVATION_KERNEL_FIXTURES.filter(
          (fixture) => fixture.split === "calibration",
        ).length,
        holdout: OBSERVATION_KERNEL_FIXTURES.filter((fixture) => fixture.split === "holdout")
          .length,
      },
      observations: {
        total: observations.length,
        unique: uniqueSemanticDigests.size,
      },
      dimensions: {
        total: OBSERVATION_KERNEL_FIXTURES.length,
        covered: coveredDimensions.size,
        missing: missingDimensions.length,
      },
      determinism: {
        repeatedRuns: 2,
        stable,
      },
    },
    quality,
    coverage,
    observations: observations.sort(
      (left, right) =>
        compareKernelCanonicalKey(left.fixtureId, right.fixtureId) ||
        left.sequence - right.sequence ||
        compareKernelCanonicalKey(left.digest, right.digest),
    ),
  };
}

export function assertObservationKernelScorecardPassed(
  scorecard: ObservationKernelScorecard,
): void {
  if (scorecard.passed) {
    return;
  }

  throw new Error(
    `Observation kernel scorecard failed: ${scorecard.failures.join(", ") || "unknown failure"}`,
  );
}

function runObservationKernelFixture(
  fixture: ObservationKernelFixture,
): ObservationKernelObservation[] {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];
  subscribeInternalTrace(core, (trace) => {
    traces.push(trace);
  });

  for (const event of fixture.events) {
    core.publish(normalizeSourceEvent(event));
  }

  let sequence = 0;
  return traces.flatMap((trace) => {
    if (!isCandidateTrace(trace)) {
      return [];
    }
    const observation = trace.evaluation.adjusted.judgmentInput.observation;
    if (observation === undefined) {
      return [];
    }
    const fields: ObservationKernelFields = {
      kind: observation.kind,
      polarity: observation.polarity,
      owner: observation.ownership.owner,
      toolFamily: observation.ownership.toolFamily ?? null,
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
    const judgment = projectObservationJudgmentContract(observation);
    const decision: ObservationKernelDecisionFields = {
      plannerKind: trace.coordination.kind,
      resultLane: trace.coordination.resultLane,
    };
    const observationSequence = sequence++;
    const judgmentDigest = digestKernelCanonicalJson(judgment);
    const semanticDigest = digestKernelCanonicalJson(fields);
    const decisionDigest = digestKernelCanonicalJson(decision);

    return [
      {
        fixtureId: fixture.id,
        dimension: fixture.dimension,
        sequence: observationSequence,
        digest: digestKernelCanonicalJson({
          fixtureId: fixture.id,
          dimension: fixture.dimension,
          split: fixture.split,
          sequence: observationSequence,
          fields,
          judgment,
          decision,
        }),
        semanticDigest,
        judgmentDigest,
        decisionDigest,
        split: fixture.split,
        fields,
        judgment,
        decision,
      },
    ];
  });
}

function buildObservationKernelCoverage(
  observations: readonly ObservationKernelObservation[],
): ObservationKernelCoverage {
  const accumulators = createObservationAccumulators();
  for (const observation of observations) {
    const values: Array<[keyof ObservationKernelCoverage, string | null]> = [
      ["splits", observation.split],
      ["dimensions", observation.dimension],
      ["kinds", observation.fields.kind],
      ["polarities", observation.fields.polarity],
      ["owners", observation.fields.owner],
      ["subjects", observation.fields.subject],
      ["evidenceLosses", observation.fields.evidenceLoss],
      ["evidenceStrengths", observation.fields.evidenceStrength],
      ["semanticAgreements", observation.fields.semanticAgreement],
      ["diagnosticClasses", observation.fields.diagnosticClass],
      ["recoveryHints", observation.fields.recoveryHint],
      ["provenanceOrigins", observation.fields.provenanceOrigin],
      ["provenanceAuthorities", observation.fields.provenanceAuthority],
      ["consequenceBaselines", observation.fields.consequenceBaseline],
    ];
    for (const [field, value] of values) {
      addObservationOutcome(accumulators[field], value, observation.fixtureId);
    }
  }

  return {
    splits: finalizeObservationDistribution(accumulators.splits),
    dimensions: finalizeObservationDistribution(accumulators.dimensions),
    kinds: finalizeObservationDistribution(accumulators.kinds),
    polarities: finalizeObservationDistribution(accumulators.polarities),
    owners: finalizeObservationDistribution(accumulators.owners),
    subjects: finalizeObservationDistribution(accumulators.subjects),
    evidenceLosses: finalizeObservationDistribution(accumulators.evidenceLosses),
    evidenceStrengths: finalizeObservationDistribution(accumulators.evidenceStrengths),
    semanticAgreements: finalizeObservationDistribution(accumulators.semanticAgreements),
    diagnosticClasses: finalizeObservationDistribution(accumulators.diagnosticClasses),
    recoveryHints: finalizeObservationDistribution(accumulators.recoveryHints),
    provenanceOrigins: finalizeObservationDistribution(accumulators.provenanceOrigins),
    provenanceAuthorities: finalizeObservationDistribution(accumulators.provenanceAuthorities),
    consequenceBaselines: finalizeObservationDistribution(accumulators.consequenceBaselines),
  };
}

function createObservationAccumulators(): Record<
  keyof ObservationKernelCoverage,
  ObservationAccumulator
> {
  return {
    splits: new Map(),
    dimensions: new Map(),
    kinds: new Map(),
    polarities: new Map(),
    owners: new Map(),
    subjects: new Map(),
    evidenceLosses: new Map(),
    evidenceStrengths: new Map(),
    semanticAgreements: new Map(),
    diagnosticClasses: new Map(),
    recoveryHints: new Map(),
    provenanceOrigins: new Map(),
    provenanceAuthorities: new Map(),
    consequenceBaselines: new Map(),
  };
}

function addObservationOutcome(
  accumulator: ObservationAccumulator,
  value: string | null,
  fixtureId: string,
): void {
  if (value === null || value.length === 0) {
    return;
  }

  const current = accumulator.get(value) ?? { count: 0, fixtureIds: new Set<string>() };
  current.count += 1;
  current.fixtureIds.add(fixtureId);
  accumulator.set(value, current);
}

function finalizeObservationDistribution(
  accumulator: ObservationAccumulator,
): ObservationKernelDistribution {
  return [...accumulator.entries()]
    .map(([id, entry]) => ({
      id,
      count: entry.count,
      fixtureCount: entry.fixtureIds.size,
      fixtureIds: [...entry.fixtureIds].sort(compareKernelCanonicalKey),
    }))
    .sort((left, right) => compareKernelCanonicalKey(left.id, right.id));
}

function collectThresholdFailures(input: {
  observations: readonly ObservationKernelObservation[];
  uniqueSemanticDigests: ReadonlySet<string>;
  coveredDimensions: ReadonlySet<string>;
  missingDimensions: readonly string[];
}): string[] {
  const failures: string[] = [];
  const observedFixtureCount = new Set(
    input.observations.map((observation) => observation.fixtureId),
  ).size;
  if (
    OBSERVATION_KERNEL_FIXTURES.length < OBSERVATION_KERNEL_SCORECARD_THRESHOLDS.minimumFixtures
  ) {
    failures.push(`observation_kernel:fixtures:${OBSERVATION_KERNEL_FIXTURES.length}<minimum`);
  }
  if (observedFixtureCount < OBSERVATION_KERNEL_SCORECARD_THRESHOLDS.minimumObservationFixtures) {
    failures.push(`observation_kernel:observation_fixtures:${observedFixtureCount}<minimum`);
  }
  if (input.observations.length < OBSERVATION_KERNEL_SCORECARD_THRESHOLDS.minimumObservations) {
    failures.push(`observation_kernel:observations:${input.observations.length}<minimum`);
  }
  if (
    input.coveredDimensions.size < OBSERVATION_KERNEL_SCORECARD_THRESHOLDS.minimumCoveredDimensions
  ) {
    failures.push(`observation_kernel:dimensions:${input.coveredDimensions.size}<minimum`);
  }
  for (const dimension of input.missingDimensions) {
    failures.push(`observation_kernel:missing_dimension:${dimension}`);
  }
  return failures;
}

function readObservationDigestList(observations: readonly ObservationKernelObservation[]): string {
  return observations
    .map((observation) => `${observation.fixtureId}:${observation.digest}`)
    .sort(compareKernelCanonicalKey)
    .join("\n");
}
