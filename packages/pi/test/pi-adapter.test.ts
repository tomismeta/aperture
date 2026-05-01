import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionResponse, SourceEvent } from "@tomismeta/aperture-core";

import {
  bindAperturePiExtension,
  createPiInstanceKey,
  mapPiEvent,
  mapPiResponse,
  parsePiInteractionId,
  type PiExtensionApi,
  type PiExtensionContext,
  type PiEvent,
  type PiRuntimeClient,
} from "../src/index.js";

const fixedNow = "2026-05-01T17:00:00.000Z";
const context = {
  cwd: "/workspace/project",
  sessionFile: "/workspace/project/.pi/sessions/session-1.json",
  now: () => fixedNow,
};

test("maps Pi tool calls into approval requests", () => {
  const mapped = mapPiEvent(
    {
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "bash",
      input: {
        command: "rm -rf dist",
      },
    },
    context,
  );

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type !== "human.input.requested") {
    return;
  }

  const instanceKey = createPiInstanceKey(context);
  assert.equal(mapped[0].taskId, `pi:${instanceKey}:session`);
  assert.equal(mapped[0].interactionId, `pi:${instanceKey}:tool:tool-1`);
  assert.equal(mapped[0].title, "Pi wants to run bash");
  assert.equal(mapped[0].summary, "rm -rf dist");
  assert.equal(mapped[0].toolFamily, "bash");
  assert.equal(mapped[0].activityClass, "permission_request");
  assert.equal(mapped[0].riskHint, "high");
  assert.deepEqual(mapped[0].metadata, {
    execution: {
      runner: "pi",
    },
    governance: {
      approvalState: "pending",
    },
  });
  assert.deepEqual(mapped[0].context?.items, [
    { id: "command", label: "Command", value: "rm -rf dist" },
    { id: "toolCallId", label: "Tool Call ID", value: "tool-1" },
    { id: "cwd", label: "Working Directory", value: "/workspace/project" },
  ]);
});

test("maps safe Pi read-like tools as low consequence approvals", () => {
  const mapped = mapPiEvent(
    {
      type: "tool_call",
      toolCallId: "tool-read-1",
      toolName: "read",
      input: {
        path: "README.md",
      },
    },
    context,
  );

  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type !== "human.input.requested") {
    return;
  }
  assert.equal(mapped[0].toolFamily, "read");
  assert.equal(mapped[0].riskHint, "low");
  assert.equal(mapped[0].summary, "README.md");
});

test("maps Pi tool execution failures into failed task updates", () => {
  const mapped = mapPiEvent(
    {
      type: "tool_execution_end",
      toolCallId: "tool-fail-1",
      toolName: "grep",
      result: {
        stderr: "pattern not found",
      },
      isError: true,
    },
    context,
  );

  assert.deepEqual(mapped, [
    {
      id: `pi:${createPiInstanceKey(context)}:event:tool_execution_end:tool-fail-1`,
      type: "task.updated",
      taskId: `pi:${createPiInstanceKey(context)}:session`,
      timestamp: fixedNow,
      source: {
        id: `pi:${createPiInstanceKey(context)}`,
        kind: "pi",
        label: "Pi project",
      },
      metadata: {
        execution: {
          runner: "pi",
        },
      },
      toolFamily: "search",
      activityClass: "tool_failure",
      title: "Pi grep failed",
      summary: '{"stderr":"pattern not found"}',
      status: "failed",
      semanticHints: {
        activityClass: "tool_failure",
        confidence: "high",
      },
    },
  ]);
});

test("maps Pi session lifecycle into task lifecycle events", () => {
  const mapped = mapPiEvent(
    {
      type: "session_start",
      reason: "resume",
      previousSessionFile: "/old/session.json",
    },
    context,
  );

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.started");
  assert.equal(mapped[0]?.title, "Pi session started");
  assert.equal(mapped[0]?.summary, "Pi session resume.");
  assert.deepEqual(mapped[0]?.metadata, {
    execution: {
      runner: "pi",
    },
    pi: {
      reason: "resume",
      previousSessionFile: "/old/session.json",
    },
  });
});

test("maps text-heavy Pi events to bounded stable ids", () => {
  const repeatedPrefix = `${"review ".repeat(20)}shared prefix`;
  const firstInput = mapPiEvent(
    {
      type: "input",
      text: `${repeatedPrefix} option A`,
      source: "interactive",
    },
    context,
  );
  const secondInput = mapPiEvent(
    {
      type: "input",
      text: `${repeatedPrefix} option B`,
      source: "interactive",
    },
    context,
  );
  const bash = mapPiEvent(
    {
      type: "user_bash",
      command: `node -e ${JSON.stringify("console.log('x')".repeat(200))}`,
    },
    context,
  );

  const instanceKey = createPiInstanceKey(context);
  assert.notEqual(firstInput[0]?.id, secondInput[0]?.id);
  assert.equal(firstInput[0]?.type, "task.updated");
  if (firstInput[0]?.type !== "task.updated") {
    return;
  }
  assert.equal(firstInput[0].summary, `${repeatedPrefix} option A`);
  assert.equal(firstInput[0]?.id.length, `pi:${instanceKey}:event:input:`.length + 16);
  assert.equal(bash[0]?.id.length, `pi:${instanceKey}:event:user_bash:`.length + 16);
});

test("maps Pi responses back into tool decisions", () => {
  const interactionId = `pi:${createPiInstanceKey(context)}:tool:tool-1`;
  assert.deepEqual(parsePiInteractionId(interactionId), {
    kind: "tool",
    instanceKey: createPiInstanceKey(context),
    toolCallId: "tool-1",
  });
  assert.deepEqual(
    mapPiResponse({
      taskId: `pi:${createPiInstanceKey(context)}:session`,
      interactionId,
      response: {
        kind: "rejected",
        reason: "Too destructive.",
      },
    }),
    {
      kind: "tool.block",
      toolCallId: "tool-1",
      reason: "Too destructive.",
    },
  );
});

test("Pi extension can hold a tool call and block on rejected Aperture response", async () => {
  const pi = new FakePiExtensionApi();
  const runtime = new FakeRuntimeClient();
  bindAperturePiExtension(pi, {
    sourceLabel: "Pi test",
    toolCallPolicy: "hold",
    responseTimeoutMs: 1_000,
    runtimeClientFactory: async () => runtime,
  });

  const resultPromise = pi.emit(
    {
      type: "tool_call",
      toolCallId: "tool-block-1",
      toolName: "write",
      input: {
        path: "src/generated.ts",
      },
    },
    {
      cwd: "/workspace/project",
      sessionManager: {
        sessionFile: "session.json",
      },
    },
  );

  await waitUntil(() => runtime.published.length === 1 && runtime.hasResponseListener());
  assert.equal(runtime.published.length, 1);
  assert.equal(runtime.published[0]?.type, "human.input.requested");
  if (runtime.published[0]?.type !== "human.input.requested") {
    return;
  }

  runtime.emitResponse({
    taskId: runtime.published[0].taskId,
    interactionId: runtime.published[0].interactionId,
    response: {
      kind: "rejected",
      reason: "Generated file writes need review.",
    },
  });

  assert.deepEqual(await resultPromise, {
    block: true,
    reason: "Generated file writes need review.",
  });
});

test("Pi extension observe mode does not create stale approval work", async () => {
  const pi = new FakePiExtensionApi();
  const runtime = new FakeRuntimeClient();
  bindAperturePiExtension(pi, {
    toolCallPolicy: "observe",
    runtimeClientFactory: async () => runtime,
  });

  const result = await pi.emit(
    {
      type: "tool_call",
      toolCallId: "tool-observe-1",
      toolName: "bash",
      input: {
        command: "pwd",
      },
    },
    {
      cwd: "/workspace/project",
    },
  );

  assert.equal(result, undefined);
  assert.deepEqual(runtime.published, []);
});

class FakePiExtensionApi implements PiExtensionApi {
  private readonly handlers = new Map<
    string,
    (event: PiEvent, context: PiExtensionContext) => unknown
  >();

  on(event: string, handler: (event: PiEvent, context: PiExtensionContext) => unknown): void {
    this.handlers.set(event, handler);
  }

  async emit(event: PiEvent, extensionContext: PiExtensionContext): Promise<unknown> {
    const handler = this.handlers.get(event.type);
    assert.ok(handler, `missing handler for ${event.type}`);
    return handler(event, extensionContext);
  }
}

class FakeRuntimeClient implements PiRuntimeClient {
  readonly published: SourceEvent[] = [];
  private responseListener: ((response: AttentionResponse) => void) | null = null;

  async publishSourceEventBatch(events: SourceEvent[]): Promise<void> {
    this.published.push(...events);
  }

  getSurfaceCount(): number {
    return 1;
  }

  onResponse(listener: (response: AttentionResponse) => void): () => void {
    this.responseListener = listener;
    return () => {
      this.responseListener = null;
    };
  }

  onError(): () => void {
    return () => {};
  }

  async close(): Promise<void> {}

  emitResponse(response: AttentionResponse): void {
    assert.ok(this.responseListener, "missing response listener");
    this.responseListener(response);
  }

  hasResponseListener(): boolean {
    return this.responseListener !== null;
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.ok(predicate(), "condition was not met in time");
}
