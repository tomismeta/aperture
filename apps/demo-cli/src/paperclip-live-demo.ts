import { ApertureCore } from "@aperture/core";
import {
  executePaperclipAction,
  mapPaperclipFrameResponse,
  mapPaperclipLiveEvent,
  streamPaperclipLiveEvents,
} from "@aperture/paperclip";

import { attachAttentionLogging, attachTraceLogging, driveInteractiveAttentionResponses } from "./lib.js";

const baseUrl = process.env.PAPERCLIP_BASE_URL;
const companyId = process.env.PAPERCLIP_COMPANY_ID;
const authToken = process.env.PAPERCLIP_AUTH_TOKEN;

if (!baseUrl || !companyId) {
  throw new Error(
    "PAPERCLIP_BASE_URL and PAPERCLIP_COMPANY_ID are required for demo:paperclip-live",
  );
}

const core = new ApertureCore();
const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;

attachAttentionLogging(core, "Aperture Paperclip Live Attention View");
if (process.env.APERTURE_TRACE === "1") {
  attachTraceLogging(core, "Aperture Paperclip Live Trace");
}

let stopped = false;
let drivingResponses = false;

process.on("SIGINT", () => {
  stopped = true;
});

core.onResponse(async (response) => {
  const action = mapPaperclipFrameResponse(response);
  if (!action) {
    return;
  }

  console.log("\nPaperclipAction");
  console.log(JSON.stringify(action, null, 2));

  try {
    await executePaperclipAction(action, {
      baseUrl,
      ...(headers ? { headers } : {}),
    });
  } catch (error) {
    console.error("\nPaperclipActionError");
    console.error(error);
  }
});

const ingestion = (async () => {
  try {
    for await (const liveEvent of streamPaperclipLiveEvents(companyId, {
      baseUrl,
      ...(headers ? { headers } : {}),
    })) {
      if (stopped) {
        break;
      }

      for (const event of mapPaperclipLiveEvent(liveEvent)) {
        core.publish(event);
      }
    }
  } finally {
    stopped = true;
  }
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

await Promise.all([ingestion, interactionLoop]);

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
