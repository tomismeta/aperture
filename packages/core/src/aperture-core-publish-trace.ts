import type { AttentionEvidenceContext } from "./attention-evidence.js";
import type { ApertureEvent } from "./events.js";
import type { AttentionTaskView, AttentionView } from "./frame.js";
import type { TraceEventTransition } from "./trace-common.js";
import type { TraceSnapshot } from "./trace-recorder.js";

export type PublishTraceSnapshotInput = {
  timestamp: string;
  event: ApertureEvent;
  eventTransition: TraceEventTransition;
  evidence: AttentionEvidenceContext;
  taskView: AttentionTaskView;
  attentionView: AttentionView;
};

export function buildPublishTraceSnapshot(
  input: PublishTraceSnapshotInput,
): TraceSnapshot {
  const { timestamp, event, eventTransition, evidence, taskView, attentionView } = input;

  return {
    timestamp,
    event,
    eventTransition,
    taskSummary: evidence.taskSignalSummary,
    globalSummary: evidence.globalSignalSummary,
    taskAttentionState: evidence.taskAttentionState,
    globalAttentionState: evidence.globalAttentionState,
    pressureForecast: evidence.pressureForecast,
    attentionBurden: evidence.attentionBurden,
    current: evidence.currentFrame,
    taskView,
    attentionView,
  };
}
