import { ApertureCore } from "@tomismeta/aperture-core";
import {
  isCandidateTrace,
  projectObservationJudgmentContract,
  subscribeInternalTrace,
  type ApertureTrace,
} from "@tomismeta/aperture-core/internal";
import { normalizeSourceEvent } from "@tomismeta/aperture-core/semantic";

import { compareKernelCanonicalKey, digestKernelCanonicalJson } from "./kernel-canonical-json.js";
import {
  OBSERVATION_KERNEL_FIXTURES,
  type ObservationKernelFixture,
} from "./observation-kernel-fixtures.js";

export const OBSERVATION_KERNEL_SCORECARD_SCHEMA_VERSION = 1 as const;
export const OBSERVATION_KERNEL_SCORECARD_PROFILE_ID = "observation-kernel-scorecard" as const;
export const OBSERVATION_KERNEL_SCORECARD_PROFILE_VERSION = 1 as const;

export const OBSERVATION_KERNEL_SCORECARD_THRESHOLDS = {
  minimumFixtures: 13,
  minimumObservationFixtures: 13,
  minimumObservations: 14,
  minimumCoveredDimensions: 13,
} as const;

export type ObservationKernelScorecard = {
  schemaVersion: typeof OBSERVATION_KERNEL_SCORECARD_SCHEMA_VERSION;
  profile: {
    id: typeof OBSERVATION_KERNEL_SCORECARD_PROFILE_ID;
    version: typeof OBSERVATION_KERNEL_SCORECARD_PROFILE_VERSION;
    suiteDigest: string;
  };
  thresholds: typeof OBSERVATION_KERNEL_SCORECARD_THRESHOLDS;
  passed: boolean;
  failures: string[];
  summary: {
    fixtures: {
      total: number;
      withObservation: number;
    };
    observations: {
      total: number;
      unique: number;
    };
    dimensions: {
      total: number;
      covered: number;
      missing: number;
    };
    determinism: {
      repeatedRuns: 2;
      stable: boolean;
    };
  };
  coverage: ObservationKernelCoverage;
  observations: ObservationKernelObservation[];
};

export type ObservationKernelCoverage = {
  dimensions: ObservationKernelDistribution;
  kinds: ObservationKernelDistribution;
  polarities: ObservationKernelDistribution;
  owners: ObservationKernelDistribution;
  subjects: ObservationKernelDistribution;
  evidenceLosses: ObservationKernelDistribution;
  evidenceStrengths: ObservationKernelDistribution;
  semanticAgreements: ObservationKernelDistribution;
  diagnosticClasses: ObservationKernelDistribution;
  recoveryHints: ObservationKernelDistribution;
  provenanceOrigins: ObservationKernelDistribution;
  provenanceAuthorities: ObservationKernelDistribution;
  consequenceBaselines: ObservationKernelDistribution;
};

export type ObservationKernelDistribution = Array<{
  id: string;
  count: number;
  fixtureCount: number;
  fixtureIds: string[];
}>;

export type ObservationKernelObservation = {
  fixtureId: string;
  dimension: string;
  sequence: number;
  digest: string;
  semanticDigest: string;
  fields: ObservationKernelFields;
  judgment: ObservationKernelJudgmentFields;
};

export type ObservationKernelFields = {
  kind: string;
  polarity: string;
  owner: string;
  toolFamily: string | null;
  subject: string;
  evidenceLoss: string;
  evidenceStrength: string;
  semanticAgreement: string;
  diagnosticClass: string | null;
  recoveryHint: string | null;
  provenanceOrigin: string;
  provenanceAuthority: string;
  consequenceBaseline: string;
};

export type ObservationKernelJudgmentFields = {
  statusEvidence: string;
  statusConflictKind: string | null;
  outcomeOnlyFailureStatus: boolean;
  limitedFailureStatus: boolean;
  stableStatusEvidence: boolean;
  visibleDiagnosticFailure: boolean;
};

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

  failures.push(
    ...collectThresholdFailures({
      observations,
      uniqueSemanticDigests,
      coveredDimensions,
      missingDimensions,
    }),
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
          events: fixture.events,
        })),
        observations: observations.map((observation) => ({
          fixtureId: observation.fixtureId,
          digest: observation.digest,
          semanticDigest: observation.semanticDigest,
        })),
      }),
    },
    thresholds: OBSERVATION_KERNEL_SCORECARD_THRESHOLDS,
    passed: failures.length === 0,
    failures,
    summary: {
      fixtures: {
        total: OBSERVATION_KERNEL_FIXTURES.length,
        withObservation: new Set(observations.map((observation) => observation.fixtureId)).size,
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
    const observationSequence = sequence++;
    const semanticDigest = digestKernelCanonicalJson({ fields, judgment });

    return [
      {
        fixtureId: fixture.id,
        dimension: fixture.dimension,
        sequence: observationSequence,
        digest: digestKernelCanonicalJson({
          fixtureId: fixture.id,
          dimension: fixture.dimension,
          sequence: observationSequence,
          fields,
          judgment,
        }),
        semanticDigest,
        fields,
        judgment,
      },
    ];
  });
}

function buildObservationKernelCoverage(
  observations: readonly ObservationKernelObservation[],
): ObservationKernelCoverage {
  const accumulators = createObservationAccumulators();
  for (const observation of observations) {
    addObservationOutcome(accumulators.dimensions, observation.dimension, observation.fixtureId);
    addObservationOutcome(accumulators.kinds, observation.fields.kind, observation.fixtureId);
    addObservationOutcome(
      accumulators.polarities,
      observation.fields.polarity,
      observation.fixtureId,
    );
    addObservationOutcome(accumulators.owners, observation.fields.owner, observation.fixtureId);
    addObservationOutcome(accumulators.subjects, observation.fields.subject, observation.fixtureId);
    addObservationOutcome(
      accumulators.evidenceLosses,
      observation.fields.evidenceLoss,
      observation.fixtureId,
    );
    addObservationOutcome(
      accumulators.evidenceStrengths,
      observation.fields.evidenceStrength,
      observation.fixtureId,
    );
    addObservationOutcome(
      accumulators.semanticAgreements,
      observation.fields.semanticAgreement,
      observation.fixtureId,
    );
    addObservationOutcome(
      accumulators.diagnosticClasses,
      observation.fields.diagnosticClass,
      observation.fixtureId,
    );
    addObservationOutcome(
      accumulators.recoveryHints,
      observation.fields.recoveryHint,
      observation.fixtureId,
    );
    addObservationOutcome(
      accumulators.provenanceOrigins,
      observation.fields.provenanceOrigin,
      observation.fixtureId,
    );
    addObservationOutcome(
      accumulators.provenanceAuthorities,
      observation.fields.provenanceAuthority,
      observation.fixtureId,
    );
    addObservationOutcome(
      accumulators.consequenceBaselines,
      observation.fields.consequenceBaseline,
      observation.fixtureId,
    );
  }

  return {
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
  if (input.uniqueSemanticDigests.size !== input.observations.length) {
    failures.push("observation_kernel:duplicate_semantic_observation_digest");
  }
  return failures;
}

function readObservationDigestList(observations: readonly ObservationKernelObservation[]): string {
  return observations
    .map((observation) => `${observation.fixtureId}:${observation.digest}`)
    .sort(compareKernelCanonicalKey)
    .join("\n");
}
