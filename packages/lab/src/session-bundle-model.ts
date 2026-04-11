import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AttentionResponse,
  AttentionSignal,
  ApertureCoreOptions,
  ApertureEvent,
} from "@tomismeta/aperture-core";
import type { ApertureTrace } from "@tomismeta/aperture-core/internal";
import type {
  ApertureRuntimeExplanationSnapshot,
  ApertureRuntimeSessionCapture,
} from "@aperture/runtime/internal";

import type {
  ReplayArtifactSource,
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplayObservationStep,
  ReplayScenarioProvenance,
  ReplaySemanticSnapshot,
  ReplayViewSnapshot,
} from "./scenario.js";
import {
  hasShape,
  isBoolean,
  isNullable,
  isNumber,
  isRecord,
  isString,
  isStringArray,
  validateWith,
} from "./shape.js";
import {
  validateApertureTrace,
  validateAttentionResponse,
  validateAttentionSignal,
  validateReplayDecisionSnapshot,
  validateReplayNormalizedEventSnapshot,
  validateReplayObservationStep,
  validateReplaySemanticSnapshot,
  validateReplayViewSnapshot,
} from "./validation.js";

export const SESSION_BUNDLE_SCHEMA_VERSION = 1 as const;

export const DEFAULT_SESSION_BUNDLES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../bundles",
);

export type ReplaySessionBundleSource = ReplayArtifactSource;

export type ReplaySessionBundleExplanation = {
  targetInteractionId?: string;
  targetLane?: "now" | "next" | "ambient" | "none";
  headline?: string;
  whyNow?: string | null;
  routingAuthority?: "status" | "request" | "event" | null;
};

export type ReplaySessionBundle = {
  schemaVersion: typeof SESSION_BUNDLE_SCHEMA_VERSION;
  sessionId: string;
  title: string;
  description?: string;
  doctrineTags?: string[];
  source?: ReplaySessionBundleSource;
  explanation?: ReplaySessionBundleExplanation;
  exportedAt: string;
  core?: ApertureCoreOptions;
  steps: ReplayObservationStep[];
  normalizedEvents: ReplayNormalizedEventSnapshot[];
  traces: ApertureTrace[];
  signals: AttentionSignal[];
  responses: AttentionResponse[];
  viewSnapshots: ReplayViewSnapshot[];
  semanticSnapshots: ReplaySemanticSnapshot[];
  decisionSnapshots: ReplayDecisionSnapshot[];
  outcomes: {
    totalSteps: number;
    surfacedFrames: number;
    finalNowInteractionId: string | null;
    finalNextCount: number;
    finalAmbientCount: number;
    finalNextInteractionIds: string[];
    finalAmbientInteractionIds: string[];
  };
};

export type RuntimeSessionCaptureExplanationLike = ApertureRuntimeExplanationSnapshot;
export type RuntimeSessionCaptureLike = ApertureRuntimeSessionCapture;

export type RuntimeSessionCaptureCursor = {
  runtimeId: string;
  counts: {
    captureSteps: number;
    publishedSourceEvents: number;
    submittedResponses: number;
    signals: number;
    traces: number;
    attentionViewSnapshots: number;
  };
  exportedAt: string;
};

export type CanonicalAttentionSnapshotLike = {
  now: { interactionId: string } | null;
  next: Array<{ interactionId: string }>;
  ambient: Array<{ interactionId: string }>;
  counts: {
    now: number;
    next: number;
    ambient: number;
  };
};

export type CanonicalAttentionLedgerSourceLike = {
  eventType: string;
  entityId?: string;
  entityType?: string;
};

export type CanonicalAttentionLedgerEntryLike =
  | {
      kind: "event";
      occurredAt: string;
      source: CanonicalAttentionLedgerSourceLike;
      apertureEvent: ApertureEvent;
    }
  | {
      kind: "response";
      occurredAt: string;
      source: CanonicalAttentionLedgerSourceLike;
      apertureResponse: AttentionResponse;
    };

export type CanonicalAttentionExportLike = {
  companyId: string;
  exportedAt: string;
  ledger: CanonicalAttentionLedgerEntryLike[];
  snapshot?: CanonicalAttentionSnapshotLike;
  reconciledSnapshot?: CanonicalAttentionSnapshotLike;
};

export type CreateSessionBundleOptions = {
  sessionId?: string;
  source?: ReplaySessionBundleSource;
  exportedAt?: string;
};

export type CreateScenarioOptions = {
  id?: string;
  title?: string;
  description?: string;
  doctrineTags?: string[];
  source?: ReplayArtifactSource;
  provenance?: ReplayScenarioProvenance;
  includeOutcomeExpectations?: boolean;
  core?: ApertureCoreOptions;
};

export function defaultSessionBundlePath(
  bundle: ReplaySessionBundle,
  directory: string = DEFAULT_SESSION_BUNDLES_DIR,
): string {
  return path.join(directory, `${safeBundleFilename(bundle.sessionId)}.json`);
}

export function validateSessionBundle(value: unknown): ReplaySessionBundle | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== SESSION_BUNDLE_SCHEMA_VERSION
    || !hasShape(
      value,
      {
        sessionId: isString,
        title: isString,
        exportedAt: isString,
        steps: (steps: unknown): steps is ReplaySessionBundle["steps"] => (
          Array.isArray(steps) && steps.every((step) => validateReplayObservationStep(step) !== null)
        ),
        normalizedEvents: (snapshots: unknown): snapshots is ReplaySessionBundle["normalizedEvents"] => (
          Array.isArray(snapshots) && snapshots.every((snapshot) => validateReplayNormalizedEventSnapshot(snapshot) !== null)
        ),
        traces: (traces: unknown): traces is ReplaySessionBundle["traces"] => (
          Array.isArray(traces) && traces.every((trace) => validateApertureTrace(trace) !== null)
        ),
        signals: (signals: unknown): signals is ReplaySessionBundle["signals"] => (
          Array.isArray(signals) && signals.every((signal) => validateAttentionSignal(signal) !== null)
        ),
        responses: (responses: unknown): responses is ReplaySessionBundle["responses"] => (
          Array.isArray(responses) && responses.every((response) => validateAttentionResponse(response) !== null)
        ),
        viewSnapshots: (snapshots: unknown): snapshots is ReplaySessionBundle["viewSnapshots"] => (
          Array.isArray(snapshots) && snapshots.every((snapshot) => validateReplayViewSnapshot(snapshot) !== null)
        ),
        semanticSnapshots: (snapshots: unknown): snapshots is ReplaySessionBundle["semanticSnapshots"] => (
          Array.isArray(snapshots) && snapshots.every((snapshot) => validateReplaySemanticSnapshot(snapshot) !== null)
        ),
        decisionSnapshots: (snapshots: unknown): snapshots is ReplaySessionBundle["decisionSnapshots"] => (
          Array.isArray(snapshots) && snapshots.every((snapshot) => validateReplayDecisionSnapshot(snapshot) !== null)
        ),
        outcomes: isSessionBundleOutcomes,
      },
      {
        description: isString,
        doctrineTags: isStringArray,
        source: validateWith(validateSessionBundleSource),
        explanation: validateWith(validateSessionBundleExplanation),
        core: isRecord,
      },
    )
  ) {
    return null;
  }

  return value as ReplaySessionBundle;
}

function safeBundleFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function validateSessionBundleSource(value: unknown): ReplaySessionBundleSource | null {
  if (
    !isRecord(value)
    || !hasShape(
      value,
      { id: isString },
      {
        kind: isString,
        label: isString,
        redacted: isBoolean,
        capture: (capture: unknown): capture is NonNullable<ReplaySessionBundleSource["capture"]> => (
          isRecord(capture)
          && hasShape(capture, {}, {
            eventTransport: isString,
            semanticCapture: isString,
            responseBridge: isString,
            notes: isStringArray,
          })
        ),
      },
    )
  ) {
    return null;
  }

  return value as ReplaySessionBundleSource;
}

function validateSessionBundleExplanation(value: unknown): ReplaySessionBundleExplanation | null {
  if (
    !isRecord(value)
    || !hasShape(value, {}, {
      targetInteractionId: isString,
      targetLane: isString,
      headline: isString,
      whyNow: isNullable(isString),
      routingAuthority: isNullable(isString),
    })
  ) {
    return null;
  }

  if (
    value.targetLane !== undefined
    && !["now", "next", "ambient", "none"].includes(String(value.targetLane))
  ) {
    return null;
  }

  if (
    value.routingAuthority !== undefined
    && value.routingAuthority !== null
    && !["status", "request", "event"].includes(String(value.routingAuthority))
  ) {
    return null;
  }

  return value as ReplaySessionBundleExplanation;
}

function isSessionBundleOutcomes(value: unknown): value is ReplaySessionBundle["outcomes"] {
  return isRecord(value) && hasShape(
    value,
    {
      totalSteps: isNumber,
      surfacedFrames: isNumber,
      finalNowInteractionId: (interactionId: unknown): interactionId is string | null => interactionId === null || isString(interactionId),
      finalNextCount: isNumber,
      finalAmbientCount: isNumber,
      finalNextInteractionIds: isStringArray,
      finalAmbientInteractionIds: isStringArray,
    },
  );
}
