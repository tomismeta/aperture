import type { AttentionFrame, AttentionView } from "@tomismeta/aperture-core";

import { NOTIFICATION_PUBLIC_SUMMARY } from "./adapter.js";
import type { ProjectedOmpSessionPresentation } from "./omp-session-presentation.js";
const EMPTY_OMP_PRESENTATION = new Map<string, ProjectedOmpSessionPresentation>();

export function projectWorkerDisplayView(
  view: AttentionView,
  displayTitleByTaskId: ReadonlyMap<string, string>,
  notificationTaskIds: ReadonlySet<string>,
  ompPresentationByTaskId: ReadonlyMap<
    string,
    ProjectedOmpSessionPresentation
  > = EMPTY_OMP_PRESENTATION,
): AttentionView {
  const project = (frame: AttentionFrame) =>
    projectWorkerDisplayFrame(
      frame,
      displayTitleByTaskId,
      notificationTaskIds,
      ompPresentationByTaskId,
    );
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
  ompPresentationByTaskId: ReadonlyMap<string, ProjectedOmpSessionPresentation>,
): AttentionFrame {
  const displayTitle = displayTitleByTaskId.get(frame.taskId);
  if (!displayTitle) return frame;
  if (!notificationTaskIds.has(frame.taskId)) {
    const presentation = ompPresentationByTaskId.get(frame.taskId);
    return {
      ...frame,
      title: displayTitle,
      ...(presentation
        ? {
            ...(frame.source
              ? { source: { ...frame.source, label: presentation.sourceLabel } }
              : {}),
            ...(presentation.context ? { context: presentation.context } : {}),
          }
        : {}),
    };
  }
  const { provenance: _provenance, ...withoutProvenance } = frame;
  return {
    ...withoutProvenance,
    title: displayTitle,
    summary: NOTIFICATION_PUBLIC_SUMMARY,
  };
}
