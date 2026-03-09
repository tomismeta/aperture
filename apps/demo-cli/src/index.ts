import { ApertureCore } from "@aperture/core";
import type { ApertureEvent } from "@aperture/core";

import { attachLogging, driveInteractiveResponses } from "./lib.js";

const TASK_ID = "task:deploy";
const core = new ApertureCore();

const scenario: ApertureEvent[] = [
  {
    id: "evt:1",
    taskId: TASK_ID,
    timestamp: new Date().toISOString(),
    type: "task.started",
    title: "Preparing deployment",
    summary: "Collecting deployment context.",
  },
  {
    id: "evt:2",
    taskId: TASK_ID,
    timestamp: new Date().toISOString(),
    type: "human.input.requested",
    interactionId: "interaction:deploy:approval",
    title: "Approve production deployment",
    summary: "A production deploy is ready and requires approval.",
    tone: "focused",
    consequence: "high",
    request: {
      kind: "approval",
    },
    context: {
      items: [
        { id: "service", label: "Service", value: "payments-api" },
        { id: "version", label: "Version", value: "2.8.1" },
      ],
    },
    provenance: {
      whyNow: "This change touches a production service.",
      factors: ["high consequence", "human approval required"],
    },
  },
  {
    id: "evt:3",
    taskId: TASK_ID,
    timestamp: new Date().toISOString(),
    type: "human.input.requested",
    interactionId: "interaction:deploy:rollback-plan",
    title: "Select rollback plan",
    summary: "A rollback plan is required before proceeding with deployment.",
    tone: "focused",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [
        { id: "blue-green", label: "Blue/green rollback" },
        { id: "hotfix", label: "Hotfix rollback" },
      ],
    },
    provenance: {
      whyNow: "Rollback planning is required for this environment.",
    },
  },
  {
    id: "evt:4",
    taskId: TASK_ID,
    timestamp: new Date().toISOString(),
    type: "task.updated",
    title: "Exception log available",
    summary: "A non-blocking diagnostics frame is available for review.",
    status: "waiting",
    progress: 85,
  },
];

attachLogging(core, TASK_ID);

for (const event of scenario) {
  core.publish(event);
}

await driveInteractiveResponses(core, TASK_ID);
