import type { AttentionFrame, AttentionView } from "@tomismeta/aperture-core";

import { NOTIFICATION_PUBLIC_SUMMARY } from "./adapter.js";

export function projectWorkerDisplayView(
  view: AttentionView,
  displayTitleByTaskId: ReadonlyMap<string, string>,
  notificationTaskIds: ReadonlySet<string>,
): AttentionView {
  const project = (frame: AttentionFrame) =>
    projectWorkerDisplayFrame(frame, displayTitleByTaskId, notificationTaskIds);
  return {
    now: view.now ? project(view.now) : null,
    next: view.next.map(project),
    ambient: view.ambient.map(project),
  };
}

function projectWorkerDisplayFrame(
  frame: AttentionFrame,
  displayTitleByTaskId: ReadonlyMap<string, string>,
  notificationTaskIds: ReadonlySet<string>,
): AttentionFrame {
  const displayTitle = displayTitleByTaskId.get(frame.taskId);
  if (!displayTitle) return frame;
  if (!notificationTaskIds.has(frame.taskId)) {
    return { ...frame, title: displayTitle };
  }
  const { provenance: _provenance, ...withoutProvenance } = frame;
  return {
    ...withoutProvenance,
    title: displayTitle,
    summary: NOTIFICATION_PUBLIC_SUMMARY,
  };
}
