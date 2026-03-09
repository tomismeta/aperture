import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { ApertureCore } from "@aperture/core";
import type { ApertureTrace, AttentionView, Frame, FrameResponse, TaskView } from "@aperture/core";
import { renderAttentionView, renderFrame, renderTaskView, renderTrace } from "@aperture/cli";

export function attachLogging(core: ApertureCore, taskId: string, label = "Aperture CLI Demo"): void {
  core.subscribe(taskId, (frame) => {
    console.log(`\n=== ${label} ===\n`);
    console.log(renderFrame(frame));
  });

  core.subscribeTaskView(taskId, (taskView) => {
    console.log("\n--- Task View ---\n");
    console.log(renderTaskView(taskView));
  });

  core.onResponse((response) => {
    console.log("\nFrameResponse");
    console.log(JSON.stringify(response, null, 2));
  });
}

export function attachAttentionLogging(
  core: ApertureCore,
  label = "Aperture Attention View",
): void {
  core.subscribeAttentionView((attentionView) => {
    console.log(`\n--- ${label} ---\n`);
    console.log(renderAttentionView(attentionView));
  });

  core.onResponse((response) => {
    console.log("\nFrameResponse");
    console.log(JSON.stringify(response, null, 2));
  });
}

export function attachTraceLogging(core: ApertureCore, label = "Aperture Trace"): void {
  core.onTrace((trace: ApertureTrace) => {
    console.log(`\n--- ${label} ---\n`);
    console.log(renderTrace(trace));
  });
}

export async function driveInteractiveResponses(core: ApertureCore, taskId: string): Promise<void> {
  const rl = createInterface({ input, output });

  try {
    // Prompt through the currently active sequence until no active frame remains.
    while (true) {
      const taskView = core.getTaskView(taskId);
      const frame = taskView.active;
      if (!frame || !frame.responseSpec || frame.responseSpec.kind === "none") {
        break;
      }

      const response = await promptForFrame(rl, frame, taskView);
      core.submit(response);
    }
  } finally {
    rl.close();
  }
}

export async function driveInteractiveAttentionResponses(core: ApertureCore): Promise<void> {
  const rl = createInterface({ input, output });

  try {
    while (true) {
      const attentionView = core.getAttentionView();
      const frame = attentionView.active;
      if (!frame || !frame.responseSpec || frame.responseSpec.kind === "none") {
        break;
      }

      const response = await promptForFrame(rl, frame, attentionView);
      core.submit(response);
    }
  } finally {
    rl.close();
  }
}

async function promptForFrame(
  rl: ReturnType<typeof createInterface>,
  frame: Frame,
  view: TaskView | AttentionView,
): Promise<FrameResponse> {
  console.log("\n--- Interactive Prompt ---");
  console.log(`Active: ${frame.title}`);
  if (frame.source?.label ?? frame.source?.id) {
    console.log(`Source: ${frame.source?.label ?? frame.source?.id}`);
  }
  if (view.queued.length > 0) {
    console.log(`Queued next: ${view.queued.map((item) => item.title).join(", ")}`);
  }
  if (view.ambient.length > 0) {
    console.log(`Ambient: ${view.ambient.map((item) => item.title).join(", ")}`);
  }

  switch (frame.responseSpec?.kind) {
    case "approval": {
      const answer = await rl.question("Approve or reject? [a/r]: ");
      return {
        taskId: frame.taskId,
        interactionId: frame.interactionId,
        response: answer.trim().toLowerCase().startsWith("r")
          ? { kind: "rejected" }
          : { kind: "approved" },
      };
    }
    case "choice": {
      frame.responseSpec.options.forEach((option, index) => {
        console.log(`${index + 1}. ${option.label}`);
      });
      const answer = await rl.question("Choose an option number: ");
      const index = Math.max(0, Number.parseInt(answer, 10) - 1);
      const selected = frame.responseSpec.options[index] ?? frame.responseSpec.options[0];
      if (!selected) {
        return {
          taskId: frame.taskId,
          interactionId: frame.interactionId,
          response: { kind: "dismissed" },
        };
      }
      return {
        taskId: frame.taskId,
        interactionId: frame.interactionId,
        response: { kind: "option_selected", optionIds: [selected.id] },
      };
    }
    case "form": {
      const values: Record<string, unknown> = {};
      for (const field of frame.responseSpec.fields) {
        const answer = await rl.question(`${field.label}: `);
        values[field.id] = answer;
      }
      return {
        taskId: frame.taskId,
        interactionId: frame.interactionId,
        response: { kind: "form_submitted", values },
      };
    }
    case "none":
    default:
      return {
        taskId: frame.taskId,
        interactionId: frame.interactionId,
        response: { kind: "dismissed" },
      };
  }
}
