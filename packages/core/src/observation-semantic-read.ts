import type { ObservationSemantics } from "./observation-semantics.js";

type ObservationExpectedSemanticRead =
  | {
      activity: "task_progress";
      intentFrame: "status_update";
      activityClass: "status_update";
    }
  | {
      activity: "failure";
      intentFrame: "failure";
      activityClass: "tool_failure";
    };

export function readObservationExpectedSemanticRead(
  observation: Pick<ObservationSemantics, "polarity">,
): ObservationExpectedSemanticRead {
  return observationReadsAsStatusUpdate(observation)
    ? {
        activity: "task_progress",
        intentFrame: "status_update",
        activityClass: "status_update",
      }
    : {
        activity: "failure",
        intentFrame: "failure",
        activityClass: "tool_failure",
      };
}

export function observationReadsAsStatusUpdate(
  observation: Pick<ObservationSemantics, "polarity"> | null,
): boolean {
  return observation?.polarity === "neutral" || observation?.polarity === "success";
}
