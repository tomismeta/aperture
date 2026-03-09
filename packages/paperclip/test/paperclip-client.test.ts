import test from "node:test";
import assert from "node:assert/strict";

import {
  executePaperclipAction,
  streamPaperclipLiveEvents,
  type PaperclipAction,
  type PaperclipClientOptions,
} from "../src/index.js";

function createFetchResponse(body: string, init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    {
      status: 200,
      ...init,
    },
  );
}

test("streams Paperclip live events from SSE data", async () => {
  const events = [
    {
      id: 1,
      companyId: "company:paperclip",
      type: "activity.logged",
      createdAt: "2026-03-09T12:00:00.000Z",
      payload: {
        entityType: "approval",
        entityId: "approval:1",
        action: "approval.created",
      },
    },
    {
      id: 2,
      companyId: "company:paperclip",
      type: "heartbeat.run.status",
      createdAt: "2026-03-09T12:00:01.000Z",
      payload: {
        runId: "run:1",
        status: "running",
      },
    },
  ];
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: PaperclipClientOptions["fetch"] = async (input, init) => {
    fetchCalls.push({
      input: String(input),
      ...(init !== undefined ? { init } : {}),
    });
    const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    return createFetchResponse(body);
  };

  const seen = [];
  for await (const event of streamPaperclipLiveEvents("company:paperclip", {
    baseUrl: "http://localhost:3000",
    fetch: fetchImpl,
  })) {
    seen.push(event);
  }

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.input, "http://localhost:3000/api/companies/company%3Apaperclip/events/ws");
  assert.equal(fetchCalls[0]?.init?.method, "GET");
  assert.deepEqual(
    seen.map((event) => event.type),
    ["activity.logged", "heartbeat.run.status"],
  );
});

test("executes Paperclip actions via fetch", async () => {
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: PaperclipClientOptions["fetch"] = async (input, init) => {
    fetchCalls.push({
      input: String(input),
      ...(init !== undefined ? { init } : {}),
    });
    return createFetchResponse("{}", { status: 200 });
  };

  const action: PaperclipAction = {
    kind: "approval.approve",
    approvalId: "approval:1",
    method: "POST",
    path: "/api/approvals/approval:1/approve",
    body: {
      decisionNote: "Ship it.",
    },
  };

  await executePaperclipAction(action, {
    baseUrl: "http://localhost:3000/",
    fetch: fetchImpl,
    headers: {
      Authorization: "Bearer token",
    },
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.input, "http://localhost:3000/api/approvals/approval:1/approve");
  assert.equal(fetchCalls[0]?.init?.method, "POST");
  assert.equal((fetchCalls[0]?.init?.headers as Record<string, string>).Authorization, "Bearer token");
  assert.equal(fetchCalls[0]?.init?.body, JSON.stringify({ decisionNote: "Ship it." }));
});
