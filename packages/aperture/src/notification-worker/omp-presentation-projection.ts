import type { AttentionFrame, AttentionView } from "@tomismeta/aperture-core";
import type { ProjectedOmpSessionPresentation } from "./omp-session-presentation.js";

export function projectOmpPresentation(
  view: AttentionView,
  displayTitleByTaskId: ReadonlyMap<string, string>,
  presentationByTaskId: ReadonlyMap<string, ProjectedOmpSessionPresentation>,
): AttentionView {
  const project = (frame: AttentionFrame): AttentionFrame => {
    const displayTitle = displayTitleByTaskId.get(frame.taskId);
    const presentation = presentationByTaskId.get(frame.taskId);
    if (!displayTitle || !presentation) return frame;
    return {
      ...frame,
      title: displayTitle,
      ...(frame.source ? { source: { ...frame.source, label: presentation.sourceLabel } } : {}),
      ...(presentation.context ? { context: presentation.context } : {}),
    };
  };
  return {
    now: view.now ? project(view.now) : null,
    next: view.next.map(project),
    ambient: view.ambient.map(project),
  };
}
