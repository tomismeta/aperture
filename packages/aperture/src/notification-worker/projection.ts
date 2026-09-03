import type { AttentionFrame } from "@tomismeta/aperture-core";

import type { ApertureSurfaceFrame } from "../surface/protocol.js";
import {
  ApertureSurfaceProjectionError,
  projectAttentionSurfaceView,
  type ApertureSurfaceProjectionInput,
} from "../surface/projection.js";
import {
  NotificationWorkerProtocolError,
  serializeNotificationWorkerOutput,
  type NotificationWorkerFrame,
  type NotificationWorkerNavigation,
  type NotificationWorkerSnapshot,
} from "./protocol.js";

export type NotificationWorkerProjectionInput = ApertureSurfaceProjectionInput & {
  navigationByTaskId: ReadonlyMap<string, NotificationWorkerNavigation>;
};

export function projectNotificationWorkerSnapshot(
  input: NotificationWorkerProjectionInput,
  sequence: number,
): NotificationWorkerSnapshot {
  const projected = projectAttentionSurfaceView(input, sequence);
  const sourceFrames = indexFrames(input.attentionView);
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
  return fitNotificationWorkerSnapshot(withNavigation);
}

function indexFrames(
  view: NotificationWorkerProjectionInput["attentionView"],
): Map<string, AttentionFrame> {
  const frames = new Map<string, AttentionFrame>();
  if (view.now) frames.set(view.now.taskId, view.now);
  for (const frame of view.next) frames.set(frame.taskId, frame);
  for (const frame of view.ambient) frames.set(frame.taskId, frame);
  return frames;
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
    throw new ApertureSurfaceProjectionError("notification worker navigation source is invalid");
  }
  const { context, provenance, timing, ...display } = frame;
  return {
    ...display,
    navigation: { kind: "opaque-focus", handle: navigation.handle },
    ...(context ? { context } : {}),
    ...(provenance ? { provenance } : {}),
    timing,
  };
}

function fitNotificationWorkerSnapshot(
  snapshot: NotificationWorkerSnapshot,
): NotificationWorkerSnapshot {
  while (!fitsNotificationWorkerOutput(snapshot)) {
    if (snapshot.view.ambient.length > 0) {
      snapshot.view.ambient.pop();
      continue;
    }
    if (snapshot.view.next.length > 0) {
      snapshot.view.next.pop();
      continue;
    }
    if (snapshot.sources.length > 0) {
      snapshot.sources.pop();
      continue;
    }
    throw new ApertureSurfaceProjectionError(
      "notification worker Now frame could not fit within the JSONL byte limit",
    );
  }
  return snapshot;
}

function fitsNotificationWorkerOutput(snapshot: NotificationWorkerSnapshot): boolean {
  try {
    serializeNotificationWorkerOutput(snapshot);
    return true;
  } catch (error) {
    if (
      error instanceof NotificationWorkerProtocolError &&
      error.message === "notification worker output exceeded the byte limit"
    ) {
      return false;
    }
    throw error;
  }
}
