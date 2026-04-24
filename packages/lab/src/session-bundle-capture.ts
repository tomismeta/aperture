import type {
  AttentionView,
  ApertureCoreOptions,
} from "@tomismeta/aperture-core";
import { normalizeSourceEvent } from "@tomismeta/aperture-core/semantic";
import { isCandidateTrace, type ApertureTrace } from "@tomismeta/aperture-core/internal";
import type {
  ApertureRuntimeAttentionViewSnapshot,
  ApertureRuntimeCaptureStep,
} from "@aperture/runtime/internal";

import type {
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplayObservationStep,
  ReplayScenario,
  ReplaySemanticSnapshot,
  ReplayViewSnapshot,
} from "./scenario.js";
import { buildDecisionSemanticSnapshot } from "./runner.js";
import {
  type CanonicalAttentionExportLike,
  type CreateScenarioOptions,
  type CreateSessionBundleOptions,
  type ReplaySessionBundle,
  type ReplaySessionBundleExplanation,
  type RuntimeSessionCaptureCursor,
  type RuntimeSessionCaptureLike,
  SESSION_BUNDLE_SCHEMA_VERSION,
} from "./session-bundle-model.js";
import { createSessionBundleFromScenario } from "./session-bundle-scenarios.js";
import { validateWorkflowTargetMetadata } from "./workflow-metadata.js";

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
    ...(capture.currentExplanation !== undefined ? { currentExplanation: capture.currentExplanation } : {}),
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
  const explanation = bundleExplanationFromRuntimeCapture(capture);

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
    ...(explanation !== undefined ? { explanation } : {}),
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

function bundleExplanationFromRuntimeCapture(
  capture: RuntimeSessionCaptureLike,
): ReplaySessionBundleExplanation | undefined {
  const explanation = capture.currentExplanation;
  if (!explanation) {
    return undefined;
  }

  if (
    explanation.targetInteractionId === null
    && explanation.headline === null
    && explanation.targetMetadata === null
    && explanation.whyNow === null
    && explanation.routingAuthority === null
  ) {
    return undefined;
  }

  const targetMetadata = explanation.targetMetadata === null
    ? null
    : validateWorkflowTargetMetadata(explanation.targetMetadata);

  return {
    ...(explanation.targetInteractionId !== null ? { targetInteractionId: explanation.targetInteractionId } : {}),
    ...(explanation.targetLane !== "none" ? { targetLane: explanation.targetLane } : {}),
    ...(explanation.headline !== null ? { headline: explanation.headline } : {}),
    ...(targetMetadata ? { targetMetadata } : {}),
    ...(explanation.whyNow !== null ? { whyNow: explanation.whyNow } : {}),
    ...(explanation.routingAuthority !== null ? { routingAuthority: explanation.routingAuthority } : {}),
  };
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
  snapshot: ApertureRuntimeAttentionViewSnapshot,
  stepIndexBySequence: Map<number, number>,
  captureSteps: ApertureRuntimeCaptureStep[],
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

function emptyAttentionView(): AttentionView {
  return {
    now: null,
    next: [],
    ambient: [],
  };
}
