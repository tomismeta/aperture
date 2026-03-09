import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { ApertureCore } from "@aperture/core";
import {
  executePaperclipAction,
  mapPaperclipFrameResponse,
  mapPaperclipLiveEvent,
  streamPaperclipLiveEvents,
  type PaperclipLiveEvent,
} from "@aperture/paperclip";

import { attachAttentionLogging, attachTraceLogging, driveInteractiveAttentionResponses } from "./lib.js";

const companyId = "company:mock";
const server = createMockPaperclipServer(companyId);
const address = await server.listen();
const baseUrl = `http://127.0.0.1:${address.port}`;

console.log(`Mock Paperclip server listening at ${baseUrl}`);
console.log("Starting live Aperture loop against the mock SSE stream.\n");

const core = new ApertureCore();
attachAttentionLogging(core, "Aperture Mock Paperclip Attention View");
if (process.env.APERTURE_TRACE === "1") {
  attachTraceLogging(core, "Aperture Mock Paperclip Trace");
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
  await executePaperclipAction(action, { baseUrl });
});

const ingestion = (async () => {
  try {
    for await (const liveEvent of streamPaperclipLiveEvents(companyId, { baseUrl })) {
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

await Promise.race([ingestion, interactionLoop]);
await server.close();

type MockPaperclipServer = {
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
};

function createMockPaperclipServer(companyId: string): MockPaperclipServer {
  const clients = new Set<ServerResponse<IncomingMessage>>();
  let nextEventId = 1;

  const approvals = new Map<
    string,
    {
      status: "pending" | "approved" | "rejected" | "revision_requested";
      type: string;
      issueIds: string[];
      requestedByAgentId: string;
    }
  >();

  const server = createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400).end();
      return;
    }

    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === `/api/companies/${encodeURIComponent(companyId)}/events/ws`) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
      clients.add(res);
      req.on("close", () => {
        clients.delete(res);
      });
      return;
    }

    const approveMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|reject|request-revision)$/);
    if (req.method === "POST" && approveMatch) {
      const approvalId = decodeURIComponent(approveMatch[1] ?? "");
      const action = approveMatch[2];
      const approval = approvals.get(approvalId);
      if (!approval) {
        res.writeHead(404).end(JSON.stringify({ error: "approval not found" }));
        return;
      }

      approval.status =
        action === "approve"
          ? "approved"
          : action === "reject"
            ? "rejected"
            : "revision_requested";

      emit({
        id: nextEventId++,
        companyId,
        type: "activity.logged",
        createdAt: new Date().toISOString(),
        payload: {
          entityType: "approval",
          entityId: approvalId,
          action:
            action === "approve"
              ? "approval.approved"
              : action === "reject"
                ? "approval.rejected"
                : "approval.revision_requested",
          details: {
            type: approval.type,
            requestedByAgentId: approval.requestedByAgentId,
            issueIds: approval.issueIds,
          },
        },
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
  });

  function emit(event: PaperclipLiveEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
  }

  async function scheduleInitialStream(): Promise<void> {
    const approvalId = "approval:hire:mock-1";
    approvals.set(approvalId, {
      status: "pending",
      type: "hire_agent",
      issueIds: ["ISS-17"],
      requestedByAgentId: "agent:paperclip:ceo",
    });

    await sleep(150);
    emit({
      id: nextEventId++,
      companyId,
      type: "activity.logged",
      createdAt: new Date().toISOString(),
      payload: {
        entityType: "approval",
        entityId: approvalId,
        action: "approval.created",
        details: {
          type: "hire_agent",
          requestedByAgentId: "agent:paperclip:ceo",
          issueIds: ["ISS-17"],
        },
      },
    });

    await sleep(200);
    emit({
      id: nextEventId++,
      companyId,
      type: "heartbeat.run.status",
      createdAt: new Date().toISOString(),
      payload: {
        runId: "run:paperclip:mock-1",
        agentId: "agent:paperclip:dev",
        status: "failed",
        error: "Migration failed in staging",
      },
    });

    await sleep(200);
    emit({
      id: nextEventId++,
      companyId,
      type: "activity.logged",
      createdAt: new Date().toISOString(),
      payload: {
        entityType: "issue",
        entityId: "ISS-17",
        action: "issue.updated",
        details: {
          title: "Finalize hiring plan",
          status: "blocked",
          description: "Hiring plan is blocked on operator decision.",
        },
      },
    });
  }

  return {
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });

      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Mock Paperclip server did not bind to a TCP port");
      }

      void scheduleInitialStream();
      return { port: address.port };
    },
    async close() {
      for (const client of clients) {
        client.end();
      }
      clients.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
