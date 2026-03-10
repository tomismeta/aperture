import { ApertureCore } from "@aperture/core";
import { createClaudeCodeHookServer } from "@aperture/claude-code/server";

import { attachAttentionLogging, attachTraceLogging, driveInteractiveAttentionResponses } from "./lib.js";

const core = new ApertureCore();
const server = createClaudeCodeHookServer(core, { holdTimeoutMs: 20_000 });
const { url } = await server.listen();

console.log(`Claude Code hook server listening at ${url}`);
console.log("Posting synthetic Claude Code hook events into Aperture.\n");

attachAttentionLogging(core, "Aperture Claude Code Attention View");
if (process.env.APERTURE_TRACE === "1") {
  attachTraceLogging(core, "Aperture Claude Code Trace");
}

let stopped = false;
let drivingResponses = false;

process.on("SIGINT", () => {
  stopped = true;
});

const hookLoop = (async () => {
  const firstApproval = postHook(url, {
    session_id: "session-alpha",
    cwd: "/workspace/repo-a",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "tool-1",
    tool_input: {
      command: "git push --force origin main",
      description: "Claude Code wants to force-push the deployment branch.",
    },
  });

  await sleep(150);

  const secondApproval = postHook(url, {
    session_id: "session-beta",
    cwd: "/workspace/repo-b",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "tool-2",
    tool_input: {
      command: "npm test",
      description: "Claude Code wants to run the test suite.",
    },
  });

  await sleep(150);

  await postHook(url, {
    session_id: "session-gamma",
    cwd: "/workspace/repo-c",
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_use_id: "tool-3",
    error: "Migration failed in staging",
  });

  console.log("\nClaudeHookResponse");
  console.log(JSON.stringify(await firstApproval, null, 2));

  console.log("\nClaudeHookResponse");
  console.log(JSON.stringify(await secondApproval, null, 2));

  stopped = true;
})();

const interactionLoop = (async () => {
  while (!stopped) {
    const activeFrame = core.getAttentionView().active;
    const needsResponse =
      activeFrame &&
      activeFrame.responseSpec &&
      activeFrame.responseSpec.kind !== "none";

    if (needsResponse && !drivingResponses) {
      drivingResponses = true;
      try {
        await driveInteractiveAttentionResponses(core);
      } finally {
        drivingResponses = false;
      }
    }

    await sleep(250);
  }
})();

await Promise.race([hookLoop, interactionLoop]);
await server.close();

async function postHook(url: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return response.json();
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
