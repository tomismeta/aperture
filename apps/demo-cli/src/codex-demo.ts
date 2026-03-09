import { ApertureCore } from "@aperture/core";
import type { CodexServerRequest } from "@aperture/codex";
import { mapCodexFrameResponse, mapCodexServerRequest } from "@aperture/codex";

import { attachAttentionLogging, attachTraceLogging, driveInteractiveAttentionResponses } from "./lib.js";

async function main(): Promise<void> {
  const core = new ApertureCore();

  const requests: CodexServerRequest[] = [
    {
      id: 17,
      method: "item/commandExecution/requestApproval",
      params: {
        itemId: "item:cmd:1",
        threadId: "thread-1",
        turnId: "turn-1",
        command: "git push origin main",
        cwd: "/Users/tom/dev/aperture",
        reason: "Network access required to push the branch.",
      },
    },
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
          {
            id: "environment",
            header: "Environment",
            question: "Select an environment.",
            options: [{ label: "staging", description: "Preview environment" }],
          },
        ],
      },
    },
  ];

  attachAttentionLogging(core, "Aperture Codex Attention View");
  if (process.env.APERTURE_TRACE === "1") {
    attachTraceLogging(core, "Aperture Codex Trace");
  }

  core.onResponse((response) => {
    const action = mapCodexFrameResponse(response);
    if (action) {
      console.log("\nCodexResponse");
      console.log(JSON.stringify(action, null, 2));
    }
  });

  for (const request of requests) {
    const apertureEvents = mapCodexServerRequest(request);
    for (const event of apertureEvents) {
      core.publish(event);
    }
  }

  await driveInteractiveAttentionResponses(core);
}

void main();
