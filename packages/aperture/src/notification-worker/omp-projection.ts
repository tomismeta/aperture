import type { AttentionFrame } from "@tomismeta/aperture-core";

import type { ApertureSurfaceFrame } from "../surface/protocol.js";
import {
  ApertureSurfaceProjectionError,
  projectAttentionSurfaceView,
  type ApertureSurfaceProjectionInput,
} from "../surface/projection.js";
import type {
  NotificationWorkerFrame,
  NotificationWorkerNavigation,
  NotificationWorkerSnapshot,
} from "./protocol.js";
import { OmpWorkerProtocolError, serializeOmpWorkerOutput } from "./omp-worker-protocol.js";

export type OmpWorkerProjectionInput = ApertureSurfaceProjectionInput & {
  navigationByTaskId: ReadonlyMap<string, NotificationWorkerNavigation>;
};

export function projectOmpWorkerSnapshot(
  input: OmpWorkerProjectionInput,
  sequence: number,
): NotificationWorkerSnapshot {
  const projected = projectAttentionSurfaceView(input, sequence);
  const sourceFrames = new Map<string, AttentionFrame>();
  if (input.attentionView.now) {
    sourceFrames.set(input.attentionView.now.taskId, input.attentionView.now);
  }
  for (const frame of input.attentionView.next) sourceFrames.set(frame.taskId, frame);
  for (const frame of input.attentionView.ambient) sourceFrames.set(frame.taskId, frame);
  const withNavigation: NotificationWorkerSnapshot = {
    ...projected,
    view: {
      now: projected.view.now
        ? addNavigation(projected.view.now, sourceFrames, input.navigationByTaskId)
        : null,
      next: projected.view.next.map((frame) =>
        addNavigation(frame, sourceFrames, input.navigationByTaskId),
      ),
      ambient: projected.view.ambient.map((frame) =>
        addNavigation(frame, sourceFrames, input.navigationByTaskId),
      ),
    },
  };
  while (!fits(withNavigation)) {
    if (withNavigation.view.ambient.length > 0) withNavigation.view.ambient.pop();
    else if (withNavigation.view.next.length > 0) withNavigation.view.next.pop();
    else if (withNavigation.sources.length > 0) withNavigation.sources.pop();
    else {
      throw new ApertureSurfaceProjectionError(
        "OMP worker Now frame could not fit within the JSONL byte limit",
      );
    }
  }
  return withNavigation;
}

function addNavigation(
  frame: ApertureSurfaceFrame,
  sourceFrames: ReadonlyMap<string, AttentionFrame>,
  navigationByTaskId: ReadonlyMap<string, NotificationWorkerNavigation>,
): NotificationWorkerFrame {
  const navigation = navigationByTaskId.get(frame.taskId);
  if (!navigation) return frame;
  const sourceFrame = sourceFrames.get(frame.taskId);
  if (
    sourceFrame?.source?.kind !== "omp" ||
    navigation.kind !== "opaque-focus" ||
    !/^[A-Za-z0-9_-]{32}$/.test(navigation.handle)
  ) {
    throw new ApertureSurfaceProjectionError("OMP worker navigation source is invalid");
  }
  return { ...frame, navigation: { kind: "opaque-focus", handle: navigation.handle } };
}

function fits(snapshot: NotificationWorkerSnapshot): boolean {
  try {
    serializeOmpWorkerOutput(snapshot);
    return true;
  } catch (error) {
    if (
      error instanceof OmpWorkerProtocolError &&
      error.message === "OMP worker output exceeded the byte limit"
    ) {
      return false;
    }
    throw error;
  }
}
