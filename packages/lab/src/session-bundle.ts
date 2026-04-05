import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AttentionView,
  ApertureEvent,
  ApertureCoreOptions,
  AttentionResponse,
  AttentionSignal,
  SourceEvent,
} from "@tomismeta/aperture-core";
import { normalizeSourceEvent } from "@tomismeta/aperture-core/semantic";
import { isCandidateTrace, type ApertureTrace } from "../../core/src/trace-types.js";

import type {
  ReplayArtifactSource,
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplayObservationStep,
  ReplayScenario,
  ReplayScenarioExpectations,
  ReplayScenarioProvenance,
  ReplaySemanticSnapshot,
  ReplayViewSnapshot,
} from "./scenario.js";
import {
  buildDecisionSemanticSnapshot,
  runReplayScenario,
  type ReplayRunResult,
} from "./runner.js";
import { scoreReplayRun } from "./scorecard.js";
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
  validateApertureTrace,
  validateAttentionResponse,
  validateAttentionSignal,
  validateReplayDecisionSnapshot,
  validateReplayNormalizedEventSnapshot,
  validateReplayObservationStep,
  validateReplaySemanticSnapshot,
  validateReplayViewSnapshot,
  validateSourceEvent,
} from "./validation.js";

export const SESSION_BUNDLE_SCHEMA_VERSION = 1 as const;

export const DEFAULT_SESSION_BUNDLES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../bundles",
);

export type ReplaySessionBundleSource = ReplayArtifactSource;

export type ReplaySessionBundle = {
  schemaVersion: typeof SESSION_BUNDLE_SCHEMA_VERSION;
  sessionId: string;
  title: string;
  description?: string;
  doctrineTags?: string[];
  source?: ReplaySessionBundleSource;
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

export type RuntimeSessionCaptureLike = {
  runtimeId: string;
  kind: string;
  exportedAt: string;
  captureSteps: Array<
    | {
        sequence: number;
        recordedAt: string;
        kind: "publishSource";
        event: SourceEvent;
      }
    | {
        sequence: number;
        recordedAt: string;
        kind: "submit";
        response: AttentionResponse;
      }
  >;
  publishedSourceEvents: SourceEvent[];
  submittedResponses: AttentionResponse[];
  signals: AttentionSignal[];
  traces: ApertureTrace[];
  attentionViewSnapshots: Array<{
    sequence: number;
    recordedAt: string;
    attentionView: AttentionView;
  }>;
  currentAttentionView: AttentionView;
};

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

type CreateSessionBundleOptions = {
  sessionId?: string;
  source?: ReplaySessionBundleSource;
  exportedAt?: string;
};

type CreateScenarioOptions = {
  id?: string;
  title?: string;
  description?: string;
  doctrineTags?: string[];
  source?: ReplayArtifactSource;
  provenance?: ReplayScenarioProvenance;
  includeOutcomeExpectations?: boolean;
  core?: ApertureCoreOptions;
};

export function createSessionBundle(
  result: ReplayRunResult,
  options: CreateSessionBundleOptions = {},
): ReplaySessionBundle {
  const scorecard = scoreReplayRun(result);

  return {
    schemaVersion: SESSION_BUNDLE_SCHEMA_VERSION,
    sessionId: options.sessionId ?? result.scenario.id,
    title: result.scenario.title,
    ...(result.scenario.description !== undefined ? { description: result.scenario.description } : {}),
    ...(result.scenario.doctrineTags !== undefined ? { doctrineTags: result.scenario.doctrineTags } : {}),
    ...(options.source !== undefined ? { source: options.source } : {}),
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    ...(result.scenario.core !== undefined ? { core: result.scenario.core } : {}),
    steps: result.scenario.steps,
    normalizedEvents: result.normalizedEvents,
    traces: result.traces,
    signals: result.signals,
    responses: result.responses,
    viewSnapshots: result.views,
    semanticSnapshots: result.semantics,
    decisionSnapshots: result.decisions,
    outcomes: scorecard.outcomes,
  };
}

export function createSessionBundleFromScenario(
  scenario: ReplayScenario,
  options: CreateSessionBundleOptions = {},
): ReplaySessionBundle {
  return createSessionBundle(runReplayScenario(scenario), options);
}

export function createRuntimeSessionCaptureCursor(
  capture: RuntimeSessionCaptureLike,
): RuntimeSessionCaptureCursor {
  return {
    runtimeId: capture.runtimeId,
    counts: {
      captureSteps: capture.captureSteps.length,
      publishedSourceEvents: capture.publishedSourceEvents.length,
      submittedResponses: capture.submittedResponses.length,
      signals: capture.signals.length,
      traces: capture.traces.length,
      attentionViewSnapshots: capture.attentionViewSnapshots.length,
    },
    exportedAt: capture.exportedAt,
  };
}

export function sliceRuntimeSessionCapture(
  capture: RuntimeSessionCaptureLike,
  cursor: RuntimeSessionCaptureCursor,
): RuntimeSessionCaptureLike {
  if (capture.runtimeId !== cursor.runtimeId) {
    throw new Error("Runtime capture cursor does not match the current runtime.");
  }

  assertCaptureSliceBounds(capture, cursor);

  const attentionViewSnapshots = capture.attentionViewSnapshots.slice(cursor.counts.attentionViewSnapshots);

  return {
    ...capture,
    captureSteps: capture.captureSteps.slice(cursor.counts.captureSteps),
    publishedSourceEvents: capture.publishedSourceEvents.slice(cursor.counts.publishedSourceEvents),
    submittedResponses: capture.submittedResponses.slice(cursor.counts.submittedResponses),
    signals: capture.signals.slice(cursor.counts.signals),
    traces: capture.traces.slice(cursor.counts.traces),
    attentionViewSnapshots,
    currentAttentionView: attentionViewSnapshots.at(-1)?.attentionView ?? emptyAttentionView(),
  };
}

export function createSessionBundleFromRuntimeCapture(
  capture: RuntimeSessionCaptureLike,
  options: CreateSessionBundleOptions & {
    title?: string;
    description?: string;
    doctrineTags?: string[];
    core?: ApertureCoreOptions;
  } = {},
): ReplaySessionBundle {
  const traceMatches = capture.traces.filter(isCandidateTrace);
  const usedTraceIndexes = new Set<number>();
  const stepIndexBySequence = new Map<number, number>();
  const scenarioSteps: ReplayObservationStep[] = [];
  const normalizedEvents: ReplayNormalizedEventSnapshot[] = [];
  const semanticSnapshots: ReplaySemanticSnapshot[] = [];
  const decisionSnapshots: ReplayDecisionSnapshot[] = [];

  capture.captureSteps.forEach((step, stepIndex) => {
    stepIndexBySequence.set(step.sequence, stepIndex);

    if (step.kind === "publishSource") {
      const normalized = normalizeSourceEvent(step.event);
      if (!normalized.semantic) {
        throw new Error("Normalized source events must preserve semantic interpretation for session bundles.");
      }

      scenarioSteps.push({
        kind: "publishSource",
        event: step.event,
      });
      normalizedEvents.push({
        stepIndex,
        stepKind: "publishSource",
        event: normalized,
      });
      semanticSnapshots.push({
        stepIndex,
        stepKind: "publishSource",
        interpretation: normalized.semantic,
      });

      const matchedTrace = findNextTraceForEvent(normalized.id, traceMatches, usedTraceIndexes);
      if (matchedTrace) {
        decisionSnapshots.push(buildDecisionSnapshotFromTrace(stepIndex, "publishSource", matchedTrace));
      }
      return;
    }

    scenarioSteps.push({
      kind: "submit",
      response: step.response,
    });
  });

  return {
    schemaVersion: SESSION_BUNDLE_SCHEMA_VERSION,
    sessionId: options.sessionId ?? capture.runtimeId,
    title: options.title ?? `Runtime capture (${capture.kind})`,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.doctrineTags !== undefined ? { doctrineTags: options.doctrineTags } : {}),
    ...(options.source !== undefined ? { source: options.source } : {}),
    exportedAt: options.exportedAt ?? capture.exportedAt,
    ...(options.core !== undefined ? { core: options.core } : {}),
    steps: scenarioSteps,
    normalizedEvents,
    traces: capture.traces,
    signals: capture.signals,
    responses: capture.submittedResponses,
    viewSnapshots: capture.attentionViewSnapshots
      .map((snapshot) => buildViewSnapshotFromRuntimeCapture(snapshot, stepIndexBySequence, capture.captureSteps))
      .filter((snapshot): snapshot is ReplayViewSnapshot => snapshot !== null),
    semanticSnapshots,
    decisionSnapshots,
    outcomes: {
      totalSteps: capture.captureSteps.length,
      surfacedFrames: traceMatches.filter((trace) => trace.result !== null).length,
      finalNowInteractionId: capture.currentAttentionView.now?.interactionId ?? null,
      finalNextCount: capture.currentAttentionView.next.length,
      finalAmbientCount: capture.currentAttentionView.ambient.length,
      finalNextInteractionIds: capture.currentAttentionView.next.map((frame) => frame.interactionId),
      finalAmbientInteractionIds: capture.currentAttentionView.ambient.map((frame) => frame.interactionId),
    },
  };
}

export function canonicalAttentionExportToScenario(
  exportArtifact: CanonicalAttentionExportLike,
  options: CreateScenarioOptions = {},
): ReplayScenario {
  const finalSnapshot = exportArtifact.reconciledSnapshot ?? exportArtifact.snapshot;

  return {
    id: options.id ?? `canonical-attention:${exportArtifact.companyId}`,
    title: options.title ?? `Attention replay for ${exportArtifact.companyId}`,
    ...(options.description !== undefined
      ? { description: options.description }
      : { description: "Replay scenario exported from a canonical Aperture ledger." }),
    ...(options.doctrineTags !== undefined
      ? { doctrineTags: options.doctrineTags }
      : { doctrineTags: ["canonical_export", "replay_export"] }),
    ...(options.core !== undefined ? { core: options.core } : {}),
    ...(finalSnapshot
      ? {
          expectations: {
            finalNowInteractionId: finalSnapshot.now?.interactionId ?? null,
            nextInteractionIds: finalSnapshot.next.map((frame) => frame.interactionId),
            ambientInteractionIds: finalSnapshot.ambient.map((frame) => frame.interactionId),
            resultLaneCounts: {
              now: finalSnapshot.counts.now,
              next: finalSnapshot.counts.next,
              ambient: finalSnapshot.counts.ambient,
            },
          },
        }
      : {}),
    steps: exportArtifact.ledger.map((entry) => (
      entry.kind === "event"
        ? {
            kind: "publish" as const,
            event: entry.apertureEvent,
            label: `${entry.source.eventType} @ ${entry.occurredAt}`,
          }
        : {
            kind: "submit" as const,
            response: entry.apertureResponse,
            label: `${entry.source.eventType} @ ${entry.occurredAt}`,
          }
    )),
  };
}

export function createSessionBundleFromCanonicalAttentionExport(
  exportArtifact: CanonicalAttentionExportLike,
  options: CreateSessionBundleOptions & CreateScenarioOptions = {},
): ReplaySessionBundle {
  const scenario = canonicalAttentionExportToScenario(exportArtifact, options);
  return createSessionBundleFromScenario(scenario, {
    sessionId: options.sessionId ?? scenario.id,
    ...(options.source !== undefined ? { source: options.source } : {}),
    exportedAt: options.exportedAt ?? exportArtifact.exportedAt,
  });
}

export function createScenarioFromSessionBundle(
  bundle: ReplaySessionBundle,
  options: CreateScenarioOptions = {},
): ReplayScenario {
  const doctrineTags = uniqueStrings([
    ...(bundle.doctrineTags ?? []),
    ...(options.doctrineTags ?? []),
  ]);
  const source = options.source ?? bundle.source;
  const includeOutcomeExpectations = options.includeOutcomeExpectations ?? true;
  const provenance = options.provenance;

  return {
    id: options.id ?? `bundle:${bundle.sessionId}`,
    title: options.title ?? bundle.title,
    ...(options.description !== undefined
      ? { description: options.description }
      : bundle.description !== undefined
        ? { description: bundle.description }
        : {}),
    ...(doctrineTags.length > 0 ? { doctrineTags } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(provenance !== undefined ? { provenance } : {}),
    ...(options.core !== undefined
      ? { core: options.core }
      : bundle.core !== undefined
        ? { core: bundle.core }
        : {}),
    ...(includeOutcomeExpectations ? { expectations: expectationsFromBundle(bundle) } : {}),
    steps: bundle.steps,
  };
}

export function sessionBundleToScenario(bundle: ReplaySessionBundle): ReplayScenario {
  return createScenarioFromSessionBundle(bundle, {
    includeOutcomeExpectations: false,
  });
}

export function runSessionBundle(bundle: ReplaySessionBundle): ReplayRunResult {
  return runReplayScenario(sessionBundleToScenario(bundle));
}

export async function loadSessionBundles(
  directory: string = DEFAULT_SESSION_BUNDLES_DIR,
): Promise<ReplaySessionBundle[]> {
  try {
    const bundles = await readSessionBundleDirectory(directory);
    return bundles.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }

    throw error;
  }
}

export async function loadSessionBundle(filePath: string): Promise<ReplaySessionBundle> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse session bundle at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const bundle = validateSessionBundle(parsed);
  if (!bundle) {
    throw new Error(`Invalid session bundle at ${filePath}`);
  }

  return bundle;
}

export async function writeSessionBundle(
  filePath: string,
  bundle: ReplaySessionBundle,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
}

export function defaultSessionBundlePath(
  bundle: ReplaySessionBundle,
  directory: string = DEFAULT_SESSION_BUNDLES_DIR,
): string {
  return path.join(directory, `${safeBundleFilename(bundle.sessionId)}.json`);
}

export function createTempSessionBundlePath(prefix: string = "aperture-session-bundle"): string {
  const basename = `${prefix}-${Date.now()}.json`;
  return path.join(os.tmpdir(), basename);
}

async function readSessionBundleDirectory(directory: string): Promise<ReplaySessionBundle[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const bundles: ReplaySessionBundle[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      bundles.push(...await readSessionBundleDirectory(absolutePath));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const raw = await readFile(absolutePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Failed to parse session bundle at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!isRecord(parsed) || parsed.schemaVersion !== SESSION_BUNDLE_SCHEMA_VERSION) {
      continue;
    }

    const bundle = validateSessionBundle(parsed);
    if (!bundle) {
      throw new Error(`Invalid session bundle at ${absolutePath}`);
    }
    bundles.push(bundle);
  }

  return bundles;
}

function safeBundleFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
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
        core: isRecord,
      },
    )
  ) {
    return null;
  }

  return value as ReplaySessionBundle;
}

function expectationsFromBundle(bundle: ReplaySessionBundle): ReplayScenarioExpectations {
  return {
    finalNowInteractionId: bundle.outcomes.finalNowInteractionId,
    nextInteractionIds: bundle.outcomes.finalNextInteractionIds,
    ambientInteractionIds: bundle.outcomes.finalAmbientInteractionIds,
    resultLaneCounts: {
      now: bundle.outcomes.finalNowInteractionId ? 1 : 0,
      next: bundle.outcomes.finalNextCount,
      ambient: bundle.outcomes.finalAmbientCount,
    },
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
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

function findNextTraceForEvent(
  eventId: string,
  traces: Array<Extract<ApertureTrace, { evaluation: { kind: "candidate" } }>>,
  usedIndexes: Set<number>,
): Extract<ApertureTrace, { evaluation: { kind: "candidate" } }> | null {
  const index = traces.findIndex((trace, traceIndex) => !usedIndexes.has(traceIndex) && trace.event.id === eventId);
  if (index === -1) {
    return null;
  }
  usedIndexes.add(index);
  return traces[index] ?? null;
}

function buildDecisionSnapshotFromTrace(
  stepIndex: number,
  stepKind: Extract<ReplayObservationStep["kind"], "publishSource">,
  trace: Extract<ApertureTrace, { evaluation: { kind: "candidate" } }>,
): ReplayDecisionSnapshot {
  return {
    stepIndex,
    stepKind,
    evaluationKind: "candidate",
    decisionKind: trace.coordination.kind,
    resultLane: trace.coordination.resultLane,
    interactionId: trace.evaluation.adjusted.interactionId,
    ...buildDecisionSemanticSnapshot(trace),
    ambiguity: trace.coordination.ambiguity,
  };
}

function buildViewSnapshotFromRuntimeCapture(
  snapshot: RuntimeSessionCaptureLike["attentionViewSnapshots"][number],
  stepIndexBySequence: Map<number, number>,
  captureSteps: RuntimeSessionCaptureLike["captureSteps"],
): ReplayViewSnapshot | null {
  const precedingStep = [...captureSteps]
    .reverse()
    .find((step) => step.sequence <= snapshot.sequence);

  if (!precedingStep) {
    return null;
  }

  const stepIndex = stepIndexBySequence.get(precedingStep.sequence);
  if (stepIndex === undefined) {
    return null;
  }

  return {
    stepIndex,
    stepKind: precedingStep.kind,
    nowInteractionId: snapshot.attentionView.now?.interactionId ?? null,
    nextInteractionIds: snapshot.attentionView.next.map((frame) => frame.interactionId),
    ambientInteractionIds: snapshot.attentionView.ambient.map((frame) => frame.interactionId),
    attentionView: snapshot.attentionView,
  };
}

function isMissingDirectoryError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function emptyAttentionView(): AttentionView {
  return {
    now: null,
    next: [],
    ambient: [],
  };
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

function assertCaptureSliceBounds(
  capture: RuntimeSessionCaptureLike,
  cursor: RuntimeSessionCaptureCursor,
): void {
  if (
    cursor.counts.captureSteps > capture.captureSteps.length
    || cursor.counts.publishedSourceEvents > capture.publishedSourceEvents.length
    || cursor.counts.submittedResponses > capture.submittedResponses.length
    || cursor.counts.signals > capture.signals.length
    || cursor.counts.traces > capture.traces.length
    || cursor.counts.attentionViewSnapshots > capture.attentionViewSnapshots.length
  ) {
    throw new Error("Runtime capture cursor is newer than the provided capture.");
  }
}
