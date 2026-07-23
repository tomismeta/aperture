import type {
  ReplayArtifactSource,
  ReplayExplanationExpectation,
  ReplayNormalizedEventSnapshot,
  ReplayObservationStep,
  ReplayScenario,
  ReplayScenarioExpectations,
  ReplayScenarioProvenance,
  ReplaySemanticExpectation,
  ReplaySemanticSnapshot,
  ReplayTraceExpectation,
  ReplayViewSnapshot,
} from "./scenario.js";
import {
  isReplaySemanticCalibrationFamily,
  SEMANTIC_CALIBRATION_FAMILIES,
  type ReplaySemanticCalibrationFamily,
} from "./semantic-calibration.js";
import {
  hasShape,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isStringArray,
  validateWith,
} from "./shape.js";
import {
  CONSEQUENCE_LEVELS,
  RELATION_KINDS,
  SEMANTIC_ACTIVITY_CLASSES,
  SEMANTIC_CONFIDENCE,
  SEMANTIC_FRAMES,
  SEMANTIC_PROVENANCE_FIELDS,
  SEMANTIC_PROVENANCE_KINDS,
  STEP_KINDS,
  isPartialSemanticOntologyDiagnostic,
  isStringOrNull,
  validateAttentionView,
  validateSemanticOntologyDiagnostic,
} from "./validation-support.js";
import {
  validateApertureEvent,
  validateAttentionResponse,
  validateAttentionSignal,
  validateSemanticInterpretation,
  validateSourceEvent,
} from "./validation-events.js";
import { validateReplayDecisionExpectation } from "./validation-replay-decision.js";
export { validateReplayDecisionSnapshot } from "./validation-replay-decision.js";

const SEMANTIC_CALIBRATION_FAMILY_SET = new Set<ReplaySemanticCalibrationFamily>(
  SEMANTIC_CALIBRATION_FAMILIES,
);

const isSemanticCalibrationFamilies = (
  value: unknown,
): value is ReplaySemanticCalibrationFamily[] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      isReplaySemanticCalibrationFamily(entry) && SEMANTIC_CALIBRATION_FAMILY_SET.has(entry),
  );

const isStep = validateWith(validateReplayObservationStep);
const isReplaySemanticExpectationGuard = validateWith(validateReplaySemanticExpectation);
const isReplayDecisionExpectationGuard = validateWith(validateReplayDecisionExpectation);
const isReplayExplanationExpectationGuard = validateWith(validateReplayExplanationExpectation);
const isReplayTraceExpectationGuard = validateWith(validateReplayTraceExpectation);
const isSemanticInterpretationGuard = validateWith(validateSemanticInterpretation);

export function validateReplayScenario(value: unknown): ReplayScenario | null {
  if (
    !isRecord(value) ||
    !hasShape(
      value,
      {
        id: isString,
        title: isString,
      },
      {
        description: isString,
        doctrineTags: isStringArray,
        semanticFamilies: isSemanticCalibrationFamilies,
        source: validateWith(validateReplayArtifactSource),
        provenance: validateWith(validateReplayScenarioProvenance),
        expectations: validateWith(validateReplayScenarioExpectations),
        core: isRecord,
      },
    ) ||
    !Array.isArray(value.steps) ||
    !value.steps.every(isStep)
  ) {
    return null;
  }

  return value as ReplayScenario;
}

export function validateReplayObservationStep(value: unknown): ReplayObservationStep | null {
  if (
    !isRecord(value) ||
    !hasShape(value, { kind: isString }, { label: isString }) ||
    !STEP_KINDS.has(value.kind as ReplayObservationStep["kind"])
  ) {
    return null;
  }

  switch (value.kind) {
    case "publish":
      return validateApertureEvent(value.event) !== null ? (value as ReplayObservationStep) : null;
    case "publishSource":
      return validateSourceEvent(value.event) !== null ? (value as ReplayObservationStep) : null;
    case "submit":
      return validateAttentionResponse(value.response) !== null
        ? (value as ReplayObservationStep)
        : null;
    case "signal":
      return validateAttentionSignal(value.signal) !== null
        ? (value as ReplayObservationStep)
        : null;
    case "markViewed":
      return typeof value.taskId === "string" &&
        typeof value.interactionId === "string" &&
        (value.surface === undefined || typeof value.surface === "string")
        ? (value as ReplayObservationStep)
        : null;
    case "markTimedOut":
      return typeof value.taskId === "string" &&
        typeof value.interactionId === "string" &&
        (value.surface === undefined || typeof value.surface === "string") &&
        (value.timeoutMs === undefined || typeof value.timeoutMs === "number")
        ? (value as ReplayObservationStep)
        : null;
    case "markContextExpanded":
    case "markContextSkipped":
      return typeof value.taskId === "string" &&
        typeof value.interactionId === "string" &&
        (value.surface === undefined || typeof value.surface === "string") &&
        (value.section === undefined || typeof value.section === "string")
        ? (value as ReplayObservationStep)
        : null;
  }

  return null;
}

export function validateReplayViewSnapshot(value: unknown): ReplayViewSnapshot | null {
  if (
    !isRecord(value) ||
    !hasShape(value, {
      stepIndex: isNumber,
      stepKind: isString,
      nowInteractionId: isStringOrNull,
      nextInteractionIds: isStringArray,
      ambientInteractionIds: isStringArray,
    }) ||
    !STEP_KINDS.has(value.stepKind as ReplayObservationStep["kind"]) ||
    validateAttentionView(value.attentionView) === null
  ) {
    return null;
  }

  return value as ReplayViewSnapshot;
}

export function validateReplaySemanticSnapshot(value: unknown): ReplaySemanticSnapshot | null {
  if (
    !isRecord(value) ||
    !hasShape(
      value,
      {
        stepIndex: isNumber,
        stepKind: isString,
        interpretation: isSemanticInterpretationGuard,
      },
      {
        ontology: isRecord,
        stepLabel: isString,
      },
    ) ||
    !STEP_KINDS.has(value.stepKind as ReplayObservationStep["kind"]) ||
    validateSemanticInterpretation(value.interpretation) === null ||
    (value.ontology !== undefined && validateSemanticOntologyDiagnostic(value.ontology) === null)
  ) {
    return null;
  }

  return value as ReplaySemanticSnapshot;
}

export function validateReplayNormalizedEventSnapshot(
  value: unknown,
): ReplayNormalizedEventSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.stepIndex !== "number" ||
    value.stepKind !== "publishSource" ||
    (value.stepLabel !== undefined && typeof value.stepLabel !== "string") ||
    validateApertureEvent(value.event) === null
  ) {
    return null;
  }

  return value as ReplayNormalizedEventSnapshot;
}

function validateReplayScenarioExpectations(value: unknown): ReplayScenarioExpectations | null {
  if (
    !isRecord(value) ||
    !hasShape(
      value,
      {},
      {
        finalNowInteractionId: isStringOrNull,
        nextInteractionIds: isStringArray,
        ambientInteractionIds: isStringArray,
        explanationExpectation: isReplayExplanationExpectationGuard,
        traceExpectations: isReplayTraceExpectationGuard,
      },
    ) ||
    (value.semanticReadings !== undefined &&
      (!Array.isArray(value.semanticReadings) ||
        !value.semanticReadings.every(isReplaySemanticExpectationGuard))) ||
    (value.decisionReadings !== undefined &&
      (!Array.isArray(value.decisionReadings) ||
        !value.decisionReadings.every(isReplayDecisionExpectationGuard)))
  ) {
    return null;
  }

  if (value.resultLaneCounts !== undefined) {
    if (
      !isRecord(value.resultLaneCounts) ||
      (value.resultLaneCounts.now !== undefined &&
        typeof value.resultLaneCounts.now !== "number") ||
      (value.resultLaneCounts.next !== undefined &&
        typeof value.resultLaneCounts.next !== "number") ||
      (value.resultLaneCounts.ambient !== undefined &&
        typeof value.resultLaneCounts.ambient !== "number")
    ) {
      return null;
    }
  }

  return value as ReplayScenarioExpectations;
}

function validateReplaySemanticExpectation(value: unknown): ReplaySemanticExpectation | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    (value.stepIndex !== undefined && typeof value.stepIndex !== "number") ||
    (value.stepLabel !== undefined && typeof value.stepLabel !== "string") ||
    (value.intentFrame !== undefined && !SEMANTIC_FRAMES.has(String(value.intentFrame))) ||
    (value.activityClass !== undefined &&
      !SEMANTIC_ACTIVITY_CLASSES.has(String(value.activityClass))) ||
    (value.toolFamily !== undefined &&
      !(value.toolFamily === null || typeof value.toolFamily === "string")) ||
    (value.consequence !== undefined && !CONSEQUENCE_LEVELS.has(String(value.consequence))) ||
    (value.confidence !== undefined && !SEMANTIC_CONFIDENCE.has(String(value.confidence))) ||
    (value.abstained !== undefined && typeof value.abstained !== "boolean") ||
    (value.relationKindsInclude !== undefined && !isStringArray(value.relationKindsInclude)) ||
    (value.relationKindsExact !== undefined && !isStringArray(value.relationKindsExact)) ||
    (value.relationHintsExact !== undefined &&
      !isSemanticRelationHintArray(value.relationHintsExact)) ||
    (value.whyNowIncludes !== undefined && typeof value.whyNowIncludes !== "string") ||
    (value.reasonsInclude !== undefined && !isStringArray(value.reasonsInclude)) ||
    (value.factorsInclude !== undefined && !isStringArray(value.factorsInclude)) ||
    (value.provenanceIncludes !== undefined &&
      !isReplaySemanticProvenanceExpectation(value.provenanceIncludes)) ||
    (value.ontology !== undefined && !isPartialSemanticOntologyDiagnostic(value.ontology))
  ) {
    return null;
  }

  return value as ReplaySemanticExpectation;
}

function isSemanticRelationHintArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isSemanticRelationHint);
}

function isSemanticRelationHint(value: unknown): boolean {
  return (
    isRecord(value) &&
    RELATION_KINDS.has(String(value.kind)) &&
    (value.target === undefined || typeof value.target === "string")
  );
}

function validateReplayExplanationExpectation(value: unknown): ReplayExplanationExpectation | null {
  if (
    !isRecord(value) ||
    !hasShape(
      value,
      {},
      {
        whyNowIncludes: isString,
        continuityRationaleIncludes: isStringArray,
      },
    )
  ) {
    return null;
  }

  return value as ReplayExplanationExpectation;
}

function isReplaySemanticProvenanceExpectation(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([field, origin]) =>
      SEMANTIC_PROVENANCE_FIELDS.has(field) &&
      typeof origin === "string" &&
      SEMANTIC_PROVENANCE_KINDS.has(origin),
  );
}

function validateReplayTraceExpectation(value: unknown): ReplayTraceExpectation | null {
  if (!isRecord(value)) {
    return null;
  }

  const keys = [
    "ambiguousDecisions",
    "ambiguousNext",
    "ambiguousAmbient",
    "ambiguousLowConfidence",
    "ambiguousAbstained",
    "ambiguousNextThenActivated",
    "ambiguousAmbientThenActivated",
    "actionableEpisodes",
    "actionableSurfaced",
    "actionableActivated",
    "deferredThenActivated",
    "suppressedThenActivated",
    "mergedEpisodeUpdates",
  ] as const;

  for (const key of keys) {
    if (value[key] !== undefined && typeof value[key] !== "number") {
      return null;
    }
  }

  return value as ReplayTraceExpectation;
}

function validateReplayArtifactSource(value: unknown): ReplayArtifactSource | null {
  if (
    !isRecord(value) ||
    !hasShape(
      value,
      { id: isString },
      {
        kind: isString,
        label: isString,
        redacted: isBoolean,
      },
    )
  ) {
    return null;
  }

  if (value.capture !== undefined) {
    if (
      !isRecord(value.capture) ||
      !hasShape(
        value.capture,
        {},
        {
          eventTransport: isString,
          semanticCapture: isString,
          responseBridge: isString,
          notes: isStringArray,
        },
      )
    ) {
      return null;
    }
  }

  return value as ReplayArtifactSource;
}

function validateReplayScenarioProvenance(value: unknown): ReplayScenarioProvenance | null {
  if (
    !isRecord(value) ||
    !hasShape(
      value,
      {},
      {
        promotedAt: isString,
        promotedFromBundleSessionId: isString,
        promotedFromPath: isString,
      },
    )
  ) {
    return null;
  }

  return value as ReplayScenarioProvenance;
}
