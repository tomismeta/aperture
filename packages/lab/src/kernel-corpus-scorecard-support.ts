import { compareKernelCanonicalKey, digestKernelCanonicalJson } from "./kernel-canonical-json.js";
import type {
  KernelCorpusScorecard,
  KernelCorpusScorecardOutcomeCoverage,
  KernelCorpusScorecardOutcomeDistribution,
  KernelCorpusScorecardScenarioCheckpoints,
} from "./kernel-corpus-scorecard.js";
import type {
  ReplayDecisionExpectation,
  ReplayScenarioExpectations,
  ReplaySemanticExpectation,
} from "./scenario.js";

export function parseKernelCorpusScorecardValue(
  source: string,
  schemaVersion: KernelCorpusScorecard["schemaVersion"],
  thresholds: KernelCorpusScorecard["thresholds"] | null,
): KernelCorpusScorecard {
  const value = JSON.parse(source) as unknown;
  if (!isKernelCorpusScorecard(value, schemaVersion, thresholds)) {
    throw new Error("Invalid kernel corpus scorecard.");
  }
  return value;
}

export function collectKernelCorpusScenarioCheckpoints(
  id: string,
  expectations: ReplayScenarioExpectations | null,
): {
  checkpoints: KernelCorpusScorecardScenarioCheckpoints;
  failures: string[];
} {
  const failures: string[] = [];
  const attentionOntology = collectUniqueCheckpointDigests(
    id,
    "attention_ontology",
    expectations?.semanticReadings ?? [],
    failures,
    isSubstantiveOntologyCheckpoint,
    buildOntologyCheckpointValue,
    hasOntologyCheckpointFields,
  );
  const relation = collectUniqueCheckpointDigests(
    id,
    "relation",
    expectations?.semanticReadings ?? [],
    failures,
    isSubstantiveRelationCheckpoint,
    buildRelationCheckpointValue,
    hasRelationCheckpointFields,
  );
  const decisionProjection = collectUniqueCheckpointDigests(
    id,
    "decision_projection",
    expectations?.decisionReadings ?? [],
    failures,
    isDecisionProjectionCheckpoint,
    buildDecisionProjectionCheckpointValue,
  );

  return {
    checkpoints: {
      id,
      attentionOntology,
      relation,
      decisionProjection,
      normalizedObservation: [],
    },
    failures,
  };
}

function isKernelCorpusScorecard(
  value: unknown,
  schemaVersion: KernelCorpusScorecard["schemaVersion"],
  thresholds: KernelCorpusScorecard["thresholds"] | null,
): value is KernelCorpusScorecard {
  return (
    isRecord(value) &&
    value.schemaVersion === schemaVersion &&
    isScorecardProfile(value.profile) &&
    typeof value.passed === "boolean" &&
    isRecord(value.proof) &&
    value.proof.retiredRegressionOracle === true &&
    value.proof.releaseEligible === false &&
    value.proof.independentPostFreezeHoldoutRequired === true &&
    isStringArray(value.failures) &&
    (thresholds === null
      ? isScorecardThresholdShape(value.thresholds)
      : isScorecardThresholds(value.thresholds, thresholds)) &&
    isScorecardSummary(value.summary) &&
    isScorecardDimensions(value.dimensions) &&
    isOutcomeCoverage(value.outcomeCoverage) &&
    isWeakestScenarios(value.weakestScenarios) &&
    isScenarioCheckpointArray(value.scenarioCheckpoints)
  );
}

function isScorecardProfile(value: unknown): value is KernelCorpusScorecard["profile"] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isFiniteNumber(value.version) &&
    typeof value.suiteDigest === "string"
  );
}

function isScorecardThresholds(
  value: unknown,
  thresholds: KernelCorpusScorecard["thresholds"],
): value is KernelCorpusScorecard["thresholds"] {
  return (
    isRecord(value) &&
    value.minimumScenarios === thresholds.minimumScenarios &&
    value.minimumCoverageDimensions === thresholds.minimumCoverageDimensions &&
    value.minimumTotalAssertions === thresholds.minimumTotalAssertions &&
    value.minimumAssertionsPerScenario === thresholds.minimumAssertionsPerScenario &&
    value.minimumAttentionOntologyCheckpoints === thresholds.minimumAttentionOntologyCheckpoints &&
    value.minimumDecisionProjectionCheckpoints ===
      thresholds.minimumDecisionProjectionCheckpoints &&
    value.minimumRelationCheckpoints === thresholds.minimumRelationCheckpoints &&
    value.minimumNormalizedObservationCheckpoints ===
      thresholds.minimumNormalizedObservationCheckpoints &&
    value.minimumNormalizedObservationScenarios === thresholds.minimumNormalizedObservationScenarios
  );
}

function isScorecardThresholdShape(value: unknown): value is KernelCorpusScorecard["thresholds"] {
  return (
    isRecord(value) &&
    isFiniteNumber(value.minimumScenarios) &&
    isFiniteNumber(value.minimumCoverageDimensions) &&
    isFiniteNumber(value.minimumTotalAssertions) &&
    isFiniteNumber(value.minimumAssertionsPerScenario) &&
    isFiniteNumber(value.minimumAttentionOntologyCheckpoints) &&
    isFiniteNumber(value.minimumDecisionProjectionCheckpoints) &&
    isFiniteNumber(value.minimumRelationCheckpoints) &&
    isFiniteNumber(value.minimumNormalizedObservationCheckpoints) &&
    isFiniteNumber(value.minimumNormalizedObservationScenarios)
  );
}

function isScorecardSummary(value: unknown): value is KernelCorpusScorecard["summary"] {
  return (
    isRecord(value) &&
    isRecord(value.scenarios) &&
    isFiniteNumber(value.scenarios.total) &&
    isFiniteNumber(value.scenarios.withFinalLaneExpectations) &&
    isRecord(value.dimensions) &&
    isFiniteNumber(value.dimensions.total) &&
    isFiniteNumber(value.dimensions.covered) &&
    isFiniteNumber(value.dimensions.missing) &&
    isRecord(value.assertions) &&
    isFiniteNumber(value.assertions.total) &&
    isFiniteNumber(value.assertions.passed) &&
    isFiniteNumber(value.assertions.failed) &&
    isFiniteNumber(value.assertions.minimumPerScenario) &&
    isFiniteNumber(value.assertions.maximumPerScenario) &&
    isFiniteNumber(value.assertions.averagePerScenario) &&
    isRecord(value.semanticCheckpoints) &&
    isFiniteNumber(value.semanticCheckpoints.total) &&
    isFiniteNumber(value.semanticCheckpoints.ontology) &&
    isFiniteNumber(value.semanticCheckpoints.relation) &&
    isRecord(value.decisionCheckpoints) &&
    isFiniteNumber(value.decisionCheckpoints.total) &&
    isFiniteNumber(value.decisionCheckpoints.projection) &&
    isRecord(value.normalizedObservationCheckpoints) &&
    isFiniteNumber(value.normalizedObservationCheckpoints.total) &&
    isFiniteNumber(value.normalizedObservationCheckpoints.scenarios) &&
    isFiniteNumber(value.normalizedObservationCheckpoints.unique) &&
    isRecord(value.fingerprints) &&
    isFiniteNumber(value.fingerprints.total) &&
    isFiniteNumber(value.fingerprints.unique) &&
    isRecord(value.determinism) &&
    isFiniteNumber(value.determinism.repeatedRuns) &&
    typeof value.determinism.stable === "boolean"
  );
}

function isScorecardDimensions(value: unknown): value is KernelCorpusScorecard["dimensions"] {
  return (
    Array.isArray(value) &&
    value.every(
      (dimension) =>
        isRecord(dimension) &&
        typeof dimension.id === "string" &&
        isFiniteNumber(dimension.scenarioCount),
    )
  );
}

function isWeakestScenarios(value: unknown): value is KernelCorpusScorecard["weakestScenarios"] {
  return (
    Array.isArray(value) &&
    value.every(
      (scenario) =>
        isRecord(scenario) &&
        typeof scenario.id === "string" &&
        isFiniteNumber(scenario.assertionCount),
    )
  );
}

function isOutcomeCoverage(value: unknown): value is KernelCorpusScorecardOutcomeCoverage {
  return (
    isRecord(value) &&
    isRecord(value.semantic) &&
    isOutcomeDistribution(value.semantic.intentFrames) &&
    isOutcomeDistribution(value.semantic.activityClasses) &&
    isOutcomeDistribution(value.semantic.toolFamilies) &&
    isOutcomeDistribution(value.semantic.consequences) &&
    isOutcomeDistribution(value.semantic.confidences) &&
    isOutcomeDistribution(value.semantic.ontologyActivities) &&
    isOutcomeDistribution(value.semantic.ontologyConsequences) &&
    isOutcomeDistribution(value.semantic.ontologySources) &&
    isRecord(value.judgment) &&
    isOutcomeDistribution(value.judgment.evaluationKinds) &&
    isOutcomeDistribution(value.judgment.decisionKinds) &&
    isOutcomeDistribution(value.judgment.decisionRecordRoutes) &&
    isOutcomeDistribution(value.judgment.plannedLanes) &&
    isOutcomeDistribution(value.judgment.resultLanes) &&
    isOutcomeDistribution(value.judgment.candidateConsequences) &&
    isOutcomeDistribution(value.judgment.semanticConfidences) &&
    isOutcomeDistribution(value.judgment.failureDetails) &&
    isOutcomeDistribution(value.judgment.normalizedObservationPresence) &&
    isOutcomeDistribution(value.judgment.normalizedObservationKinds) &&
    isOutcomeDistribution(value.judgment.normalizedObservationPolarities) &&
    isOutcomeDistribution(value.judgment.normalizedObservationEvidenceLosses) &&
    isOptionalOutcomeDistribution(value.judgment.normalizedObservationDiagnosticClasses) &&
    isOptionalOutcomeDistribution(value.judgment.normalizedObservationRecoveryHints) &&
    isOutcomeDistribution(value.judgment.normalizedObservationSubjects) &&
    isOutcomeDistribution(value.judgment.normalizedObservationOwners) &&
    isOutcomeDistribution(value.judgment.normalizedObservationEvidenceStrengths) &&
    isOutcomeDistribution(value.judgment.normalizedObservationSemanticAgreements) &&
    isOutcomeDistribution(value.judgment.normalizedObservationProvenanceOrigins) &&
    isOutcomeDistribution(value.judgment.normalizedObservationProvenanceAuthorities)
  );
}

function isOutcomeDistribution(value: unknown): value is KernelCorpusScorecardOutcomeDistribution {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  const ids = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      entry.id.length === 0 ||
      ids.has(entry.id) ||
      (index > 0 && compareKernelCanonicalKey(value[index - 1]?.id ?? "", entry.id) >= 0) ||
      !isNonNegativeInteger(entry.count) ||
      entry.count === 0 ||
      !isNonNegativeInteger(entry.scenarioCount) ||
      entry.scenarioCount === 0 ||
      entry.scenarioCount > entry.count ||
      !isStringArray(entry.scenarioIds) ||
      entry.scenarioIds.length !== entry.scenarioCount ||
      new Set(entry.scenarioIds).size !== entry.scenarioIds.length ||
      !isSortedStrings(entry.scenarioIds)
    ) {
      return false;
    }
    ids.add(entry.id);
  }

  return true;
}

function isOptionalOutcomeDistribution(
  value: unknown,
): value is KernelCorpusScorecardOutcomeDistribution {
  return Array.isArray(value) && (value.length === 0 || isOutcomeDistribution(value));
}

function isScenarioCheckpointArray(
  value: unknown,
): value is KernelCorpusScorecardScenarioCheckpoints[] {
  return Array.isArray(value) && value.every(isScenarioCheckpoints);
}

function isScenarioCheckpoints(value: unknown): value is KernelCorpusScorecardScenarioCheckpoints {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isStringArray(value.attentionOntology) &&
    isStringArray(value.relation) &&
    isStringArray(value.decisionProjection) &&
    isStringArray(value.normalizedObservation)
  );
}

function collectUniqueCheckpointDigests<Expectation>(
  id: string,
  checkpointKind: string,
  expectations: readonly Expectation[],
  failures: string[],
  isSubstantive: (expectation: Expectation) => boolean,
  buildValue: (expectation: Expectation) => unknown,
  hasCheckpointFields: (expectation: Expectation) => boolean = isSubstantive,
): string[] {
  const digests: string[] = [];
  const seen = new Set<string>();

  for (const expectation of expectations) {
    if (!hasCheckpointFields(expectation)) {
      continue;
    }
    if (!isSubstantive(expectation)) {
      failures.push(`scorecard:empty_${checkpointKind}_checkpoint:${id}`);
      continue;
    }

    const digest = digestKernelCanonicalJson(buildValue(expectation));
    if (seen.has(digest)) {
      failures.push(`scorecard:duplicate_${checkpointKind}_checkpoint:${id}:${digest}`);
      continue;
    }

    seen.add(digest);
    digests.push(digest);
  }

  return digests.sort(compareKernelCanonicalKey);
}

function isSubstantiveOntologyCheckpoint(reading: ReplaySemanticExpectation): boolean {
  return reading.ontology !== undefined && hasSubstantiveValue(reading.ontology);
}

function hasOntologyCheckpointFields(reading: ReplaySemanticExpectation): boolean {
  return reading.ontology !== undefined;
}

function buildOntologyCheckpointValue(reading: ReplaySemanticExpectation): unknown {
  return compactCanonicalValue({
    kind: "semantic_ontology",
    step: checkpointStepIdentity(reading),
    ontology: reading.ontology,
  });
}

function hasRelationCheckpointFields(reading: ReplaySemanticExpectation): boolean {
  return (
    reading.relationKindsInclude !== undefined ||
    reading.relationKindsExact !== undefined ||
    reading.relationHintsExact !== undefined
  );
}

function isSubstantiveRelationCheckpoint(reading: ReplaySemanticExpectation): boolean {
  return (
    nonEmptyStringArray(reading.relationKindsInclude) ||
    Array.isArray(reading.relationKindsExact) ||
    Array.isArray(reading.relationHintsExact)
  );
}

function buildRelationCheckpointValue(reading: ReplaySemanticExpectation): unknown {
  return compactCanonicalValue({
    kind: "semantic_relation",
    step: checkpointStepIdentity(reading),
    relationKindsInclude:
      reading.relationKindsInclude === undefined
        ? undefined
        : sortedUniqueStrings(reading.relationKindsInclude),
    relationKindsExact:
      reading.relationKindsExact === undefined
        ? undefined
        : sortedUniqueStrings(reading.relationKindsExact),
    relationHintsExact:
      reading.relationHintsExact === undefined
        ? undefined
        : reading.relationHintsExact
            .map((hint) =>
              compactCanonicalValue({
                kind: hint.kind,
                target: hint.target,
              }),
            )
            .sort(compareCheckpointValues),
  });
}

function buildDecisionProjectionCheckpointValue(reading: ReplayDecisionExpectation): unknown {
  return compactCanonicalValue({
    kind: "decision_projection",
    step: checkpointStepIdentity(reading),
    decisionRecordProjectionVersion: reading.decisionRecordProjectionVersion,
    decisionKind: reading.decisionKind,
    decisionRecordRoute: reading.decisionRecordRoute,
    plannedLane: reading.plannedLane,
    resultLane: reading.resultLane,
    decisionRecordReasonCodesInclude:
      reading.decisionRecordReasonCodesInclude === undefined
        ? undefined
        : sortedUniqueStrings(reading.decisionRecordReasonCodesInclude),
  });
}

function checkpointStepIdentity(reading: { stepIndex?: number; stepLabel?: string }): {
  stepIndex: number | null;
  stepLabel: string | null;
} {
  return {
    stepIndex: reading.stepIndex ?? null,
    stepLabel: reading.stepLabel ?? null,
  };
}

function isDecisionProjectionCheckpoint(reading: ReplayDecisionExpectation): boolean {
  return (
    reading.decisionRecordProjectionVersion !== undefined &&
    reading.decisionRecordRoute !== undefined &&
    reading.resultLane !== undefined &&
    (reading.decisionRecordReasonCodesInclude?.length ?? 0) > 0
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function nonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.some((entry) => typeof entry === "string");
}

function sortedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareKernelCanonicalKey);
}

function compareCheckpointValues(left: unknown, right: unknown): number {
  return compareKernelCanonicalKey(
    digestKernelCanonicalJson(left),
    digestKernelCanonicalJson(right),
  );
}

function compactCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compactCanonicalValue);
  }
  if (!isRecord(value)) {
    return value;
  }

  const compact: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      compact[key] = compactCanonicalValue(entry);
    }
  }
  return compact;
}

function hasSubstantiveValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasSubstantiveValue);
  }
  if (isRecord(value)) {
    return Object.values(value).some(hasSubstantiveValue);
  }
  return false;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSortedStrings(value: string[]): boolean {
  return value.every(
    (entry, index) => index === 0 || compareKernelCanonicalKey(value[index - 1] ?? "", entry) < 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
