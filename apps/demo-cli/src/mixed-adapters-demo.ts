import { ApertureCore } from "@aperture/core";
import type { CodexServerRequest } from "@aperture/codex";
import { mapCodexFrameResponse, mapCodexServerRequest } from "@aperture/codex";
import type { PaperclipLiveEvent } from "@aperture/paperclip";
import { mapPaperclipFrameResponse, mapPaperclipLiveEvent } from "@aperture/paperclip";

import { attachAttentionLogging, attachTraceLogging, driveInteractiveAttentionResponses } from "./lib.js";

async function main(): Promise<void> {
  const core = new ApertureCore();
  const now = Date.now();

  const paperclipEvents: PaperclipLiveEvent[] = [
    {
      id: 1,
      companyId: "company:paperclip",
      type: "heartbeat.run.status",
      createdAt: new Date(now).toISOString(),
      payload: {
        runId: "run:alpha",
        agentId: "agent:alpha",
        status: "running",
        triggerDetail: "release pipeline",
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
  ];

  const codexRequests: CodexServerRequest[] = [
    {
      id: "req-choice",
      method: "item/tool/requestUserInput",
      params: {
        itemId: "item:input:1",
        threadId: "thread-1",
        turnId: "turn-1",
        questions: [
          {
            id: "deploy_target",
            header: "Target",
            question: "Which environment should be used?",
            options: [
              { label: "staging", description: "Preview environment" },
              { label: "production", description: "Live traffic" },
            ],
          },
        ],
      },
    },
    {
      id: "req-form",
      method: "item/tool/requestUserInput",
      params: {
        itemId: "item:input:2",
        threadId: "thread-2",
        turnId: "turn-9",
        questions: [
          {
            id: "reason",
            header: "Reason",
            question: "Why should this command continue?",
          },
        ],
      },
    },
  ];

  attachAttentionLogging(core, "Aperture Mixed Attention View");
  if (process.env.APERTURE_TRACE === "1") {
    attachTraceLogging(core, "Aperture Mixed Trace");
  }

  core.onResponse((response) => {
    const paperclipAction = mapPaperclipFrameResponse(response);
    if (paperclipAction) {
      console.log("\nPaperclipAction");
      console.log(JSON.stringify(paperclipAction, null, 2));
      return;
    }

    const codexResponse = mapCodexFrameResponse(response);
    if (codexResponse) {
      console.log("\nCodexResponse");
      console.log(JSON.stringify(codexResponse, null, 2));
    }
  });

  for (const liveEvent of paperclipEvents) {
    for (const event of mapPaperclipLiveEvent(liveEvent)) {
      core.publish(event);
    }
  }

  for (const request of codexRequests) {
    for (const event of mapCodexServerRequest(request)) {
      core.publish(event);
    }
  }

  await driveInteractiveAttentionResponses(core);
}

void main();
