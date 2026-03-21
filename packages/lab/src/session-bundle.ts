import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  AttentionView,
  ApertureEvent,
  ApertureCoreOptions,
  AttentionResponse,
  AttentionSignal,
  SourceEvent,
} from "@tomismeta/aperture-core";
import type { ApertureTrace } from "../../core/src/trace.js";

import type {
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplayObservationStep,
  ReplayScenario,
  ReplaySemanticSnapshot,
  ReplayViewSnapshot,
} from "./scenario.js";
import { runReplayScenario, type ReplayRunResult } from "./runner.js";
import { scoreReplayRun } from "./scorecard.js";
import { normalizeSourceEvent } from "../../core/src/semantic-normalizer.js";

export const SESSION_BUNDLE_SCHEMA_VERSION = 1 as const;

export const DEFAULT_SESSION_BUNDLES_DIR = path.resolve(
  process.cwd(),
  "packages/lab/bundles",
);

export type ReplaySessionBundleSource = {
  id: string;
  kind?: string;
  label?: string;
  redacted?: boolean;
};

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
    finalActiveInteractionId: string | null;
    finalQueuedCount: number;
    finalAmbientCount: number;
    finalQueuedInteractionIds: string[];
    finalAmbientInteractionIds: string[];
  };
};

export type RuntimeSessionCaptureLike = {
  runtimeId: string;
  kind: string;
  exportedAt: string;
  steps: Array<
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
  sourceEvents: SourceEvent[];
  responses: AttentionResponse[];
  signals: AttentionSignal[];
  traces: ApertureTrace[];
  viewSnapshots: Array<{
    sequence: number;
    recordedAt: string;
    attentionView: AttentionView;
  }>;
  attentionView: AttentionView;
};

export type RuntimeSessionCaptureCursor = {
  runtimeId: string;
  counts: {
    steps: number;
    sourceEvents: number;
    responses: number;
    signals: number;
    traces: number;
    viewSnapshots: number;
  };
  exportedAt: string;
};

export type CanonicalAttentionSnapshotLike = {
  active: { interactionId: string } | null;
  queued: Array<{ interactionId: string }>;
  ambient: Array<{ interactionId: string }>;
  counts: {
    active: number;
    queued: number;
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
      steps: capture.steps.length,
      sourceEvents: capture.sourceEvents.length,
      responses: capture.responses.length,
      signals: capture.signals.length,
      traces: capture.traces.length,
      viewSnapshots: capture.viewSnapshots.length,
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

  return {
    ...capture,
    steps: capture.steps.slice(cursor.counts.steps),
    sourceEvents: capture.sourceEvents.slice(cursor.counts.sourceEvents),
    responses: capture.responses.slice(cursor.counts.responses),
    signals: capture.signals.slice(cursor.counts.signals),
    traces: capture.traces.slice(cursor.counts.traces),
    viewSnapshots: capture.viewSnapshots.slice(cursor.counts.viewSnapshots),
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

  capture.steps.forEach((step, stepIndex) => {
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
    responses: capture.responses,
    viewSnapshots: capture.viewSnapshots
      .map((snapshot) => buildViewSnapshotFromRuntimeCapture(snapshot, stepIndexBySequence, capture.steps))
      .filter((snapshot): snapshot is ReplayViewSnapshot => snapshot !== null),
    semanticSnapshots,
    decisionSnapshots,
    outcomes: {
      totalSteps: capture.steps.length,
      surfacedFrames: traceMatches.filter((trace) => trace.result !== null).length,
      finalActiveInteractionId: capture.attentionView.active?.interactionId ?? null,
      finalQueuedCount: capture.attentionView.queued.length,
      finalAmbientCount: capture.attentionView.ambient.length,
      finalQueuedInteractionIds: capture.attentionView.queued.map((frame) => frame.interactionId),
      finalAmbientInteractionIds: capture.attentionView.ambient.map((frame) => frame.interactionId),
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
            finalActiveInteractionId: finalSnapshot.active?.interactionId ?? null,
            queuedInteractionIds: finalSnapshot.queued.map((frame) => frame.interactionId),
            ambientInteractionIds: finalSnapshot.ambient.map((frame) => frame.interactionId),
            resultBucketCounts: {
              active: finalSnapshot.counts.active,
              queued: finalSnapshot.counts.queued,
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

export function sessionBundleToScenario(bundle: ReplaySessionBundle): ReplayScenario {
  return {
    id: `bundle:${bundle.sessionId}`,
    title: bundle.title,
    ...(bundle.description !== undefined ? { description: bundle.description } : {}),
    ...(bundle.doctrineTags !== undefined ? { doctrineTags: bundle.doctrineTags } : {}),
    ...(bundle.core !== undefined ? { core: bundle.core } : {}),
    steps: bundle.steps,
  };
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
    const bundle = JSON.parse(raw) as ReplaySessionBundle;
    if (bundle.schemaVersion !== SESSION_BUNDLE_SCHEMA_VERSION) {
      continue;
    }
    bundles.push(bundle);
  }

  return bundles;
}

function safeBundleFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
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
    resultBucket: trace.coordination.resultBucket,
    interactionId: trace.evaluation.adjusted.interactionId,
    ...(trace.evaluation.adjusted.semanticConfidence !== undefined
      ? { semanticConfidence: trace.evaluation.adjusted.semanticConfidence }
      : {}),
    ...(trace.evaluation.adjusted.semanticAbstained === true ? { semanticAbstained: true } : {}),
    ambiguity: trace.coordination.ambiguity,
  };
}

function buildViewSnapshotFromRuntimeCapture(
  snapshot: RuntimeSessionCaptureLike["viewSnapshots"][number],
  stepIndexBySequence: Map<number, number>,
  steps: RuntimeSessionCaptureLike["steps"],
): ReplayViewSnapshot | null {
  const precedingStep = [...steps]
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
    activeInteractionId: snapshot.attentionView.active?.interactionId ?? null,
    queuedInteractionIds: snapshot.attentionView.queued.map((frame) => frame.interactionId),
    ambientInteractionIds: snapshot.attentionView.ambient.map((frame) => frame.interactionId),
    attentionView: snapshot.attentionView,
  };
}

function isMissingDirectoryError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isCandidateTrace(
  trace: ApertureTrace,
): trace is Extract<ApertureTrace, { evaluation: { kind: "candidate" } }> {
  return trace.evaluation.kind === "candidate";
}

function assertCaptureSliceBounds(
  capture: RuntimeSessionCaptureLike,
  cursor: RuntimeSessionCaptureCursor,
): void {
  if (
    cursor.counts.steps > capture.steps.length
    || cursor.counts.sourceEvents > capture.sourceEvents.length
    || cursor.counts.responses > capture.responses.length
    || cursor.counts.signals > capture.signals.length
    || cursor.counts.traces > capture.traces.length
    || cursor.counts.viewSnapshots > capture.viewSnapshots.length
  ) {
    throw new Error("Runtime capture cursor is newer than the provided capture.");
  }
}
