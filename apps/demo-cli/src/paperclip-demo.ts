import { ApertureCore } from "@aperture/core";
import type { PaperclipLiveEvent } from "@aperture/paperclip";
import { mapPaperclipFrameResponse, mapPaperclipLiveEvent } from "@aperture/paperclip";

import { attachAttentionLogging, attachTraceLogging, driveInteractiveAttentionResponses } from "./lib.js";

const core = new ApertureCore();
const now = Date.now();

const stream: PaperclipLiveEvent[] = [
  {
    id: 1,
    companyId: "company:paperclip",
    type: "heartbeat.run.status",
    createdAt: new Date(now).toISOString(),
    payload: {
      runId: "run:alpha",
      agentId: "agent:alpha",
      status: "running",
      triggerDetail: "system",
    },
  },
  {
    id: 2,
    companyId: "company:paperclip",
    type: "activity.logged",
    createdAt: new Date(now + 100).toISOString(),
    payload: {
      entityType: "approval",
      entityId: "approval:hire:1",
      action: "approval.created",
      details: {
        type: "hire_agent",
        requestedByAgentId: "agent:alpha",
        issueIds: ["ISS-101"],
      },
    },
  },
  {
    id: 3,
    companyId: "company:paperclip",
    type: "activity.logged",
    createdAt: new Date(now + 200).toISOString(),
    payload: {
      entityType: "issue",
      entityId: "issue:blocked:7",
      action: "issue.updated",
      details: {
        identifier: "PAP-7",
        title: "Blocked on staging credential",
        status: "blocked",
      },
    },
  },
];

attachAttentionLogging(core, "Aperture Paperclip Attention View");
if (process.env.APERTURE_TRACE === "1") {
  attachTraceLogging(core, "Aperture Paperclip Trace");
}

core.onResponse((response) => {
  const action = mapPaperclipFrameResponse(response);
  if (action) {
    console.log("\nPaperclipAction");
    console.log(JSON.stringify(action, null, 2));
  }
});

for (const liveEvent of stream) {
  const apertureEvents = mapPaperclipLiveEvent(liveEvent);
  for (const event of apertureEvents) {
    core.publish(event);
  }
}

await driveInteractiveAttentionResponses(core);
