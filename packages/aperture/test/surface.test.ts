import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Writable } from "node:stream";
import test from "node:test";

import type { AttentionFrame, AttentionView } from "@tomismeta/aperture-core";
import type {
  ApertureLocalRuntimeRegistration,
  ApertureRuntimeClientOptions,
  ApertureRuntimeSnapshot,
} from "@aperture/runtime";
import { createEmptyRuntimeSnapshot } from "../../runtime/src/runtime-client-shared.js";
import { projectSurfaceSnapshot } from "../src/surface/projection.js";
import type { ApertureSurfaceRuntimeClient } from "../src/surface/runtime-session.js";
import { runApertureSurfaceStdio } from "../src/surface/stdio.js";

class LineCollector extends Writable {
  readonly lines: string[] = [];
  onLine: ((line: string) => void) | undefined;

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const value = chunk.toString();
    for (const line of value.split("\n")) {
      if (!line) {
        continue;
      }
      this.lines.push(line);
      this.onLine?.(line);
    }
    callback();
  }
}

test("surface projection is bounded and omits internal metadata and response specs", () => {
  const frame = attentionFrame();
  const snapshot = runtimeSnapshot({ now: frame, next: [], ambient: [] });
  const projected = projectSurfaceSnapshot(snapshot, 1);
  const serialized = JSON.stringify(projected);

  assert.equal(projected.sequence, 1);
  assert.equal(projected.sources.length, 1);
  assert.equal(projected.view.now?.title, "Review the migration");
  assert.equal(projected.view.now?.source?.label, "Codex");
  assert.equal(projected.view.now?.context?.items?.length, 1);
  assert.doesNotMatch(serialized, /metadata|responseSpec|private-value/);
});

test("canonical surface fixtures preserve the bounded initial capability set", async () => {
  const fixtureDirectory = new URL("./fixtures/surface-protocol/", import.meta.url);
  const fixtureNames = (await readdir(fixtureDirectory)).filter((name) => name.endsWith(".json"));
  assert.deepEqual(fixtureNames.sort(), [
    "connection-connected.json",
    "connection-connecting.json",
    "connection-disconnected.json",
    "error.json",
    "hello.json",
    "snapshot-calm.json",
    "snapshot-now.json",
  ]);

  for (const fixtureName of fixtureNames) {
    const raw = await readFile(new URL(fixtureName, fixtureDirectory), "utf8");
    const value: unknown = JSON.parse(raw);
    assert.ok(value && typeof value === "object" && "type" in value, `${fixtureName} type`);
    assert.equal(typeof value.type, "string");
    assert.doesNotMatch(raw, /metadata|responseSpec|tokenPath|controlUrl|authToken/);

    if (value.type === "snapshot") {
      assert.ok("sources" in value && Array.isArray(value.sources));
      for (const source of value.sources) {
        assert.ok(source && typeof source === "object" && "id" in source);
        assert.equal(typeof source.id, "string");
        assert.ok("kind" in source);
        assert.equal(typeof source.kind, "string");
        assert.ok("label" in source);
        assert.equal(typeof source.label, "string");
      }
    }
  }

  const schemaRaw = await readFile(
    new URL("../src/surface-protocol.schema.json", import.meta.url),
    "utf8",
  );
  const schemaValue: unknown = JSON.parse(schemaRaw);
  assert.ok(schemaValue && typeof schemaValue === "object" && "title" in schemaValue);
  assert.equal(schemaValue.title, "Aperture Surface Protocol");
  assert.doesNotMatch(schemaRaw, /responseSpec|metadata/);
});

test("stdio protocol emits hello, connection, and a complete companion snapshot in order", async () => {
  const controller = new AbortController();
  const stdout = new LineCollector();
  const stderr = new LineCollector();
  const snapshot = runtimeSnapshot({ now: attentionFrame(), next: [], ambient: [] });
  const client = fakeRuntimeClient(snapshot);
  const registration = runtimeRegistration();
  let connectOptions: ApertureRuntimeClientOptions | null = null;

  stdout.onLine = (line) => {
    const message: unknown = JSON.parse(line);
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "snapshot"
    ) {
      controller.abort();
    }
  };

  await runApertureSurfaceStdio({
    packageVersion: "0.5.0",
    label: "omarchy-attention",
    signal: controller.signal,
    stdout,
    stderr,
    dependencies: {
      discover: async () => [registration],
      connect: async (options) => {
        connectOptions = options;
        return client;
      },
      delay: async (_milliseconds, signal) => {
        if (!signal.aborted) {
          controller.abort();
        }
      },
    },
  });

  const messages = stdout.lines.map(parseObservedMessage);
  assert.deepEqual(
    messages.map((message) =>
      message.type === "connection" ? `${message.type}:${message.state}` : message.type,
    ),
    ["hello", "connection:connecting", "connection:connected", "snapshot"],
  );
  assert.equal(messages[0]?.packageVersion, "0.5.0");
  const helloValue: unknown = JSON.parse(stdout.lines[0] ?? "");
  assert.ok(helloValue && typeof helloValue === "object" && "capabilities" in helloValue);
  const capabilities = helloValue.capabilities;
  assert.ok(capabilities && typeof capabilities === "object" && "snapshots" in capabilities);
  assert.equal(capabilities.snapshots, true);
  assert.ok("responses" in capabilities);
  assert.equal(capabilities.responses, false);
  assert.ok("engagement" in capabilities);
  assert.equal(capabilities.engagement, false);
  assert.equal(connectOptions?.surfaceRole, "companion");
  assert.equal(client.closed, true);
  assert.deepEqual(stderr.lines, []);
});

test("stdio protocol reports unavailable runtime without emitting false calm", async () => {
  const controller = new AbortController();
  const stdout = new LineCollector();
  const stderr = new LineCollector();

  await runApertureSurfaceStdio({
    packageVersion: "0.5.0",
    label: "omarchy-attention",
    signal: controller.signal,
    stdout,
    stderr,
    dependencies: {
      discover: async () => [],
      delay: async () => controller.abort(),
    },
  });

  const messages = stdout.lines.map(parseObservedMessage);
  assert.deepEqual(
    messages.map((message) =>
      message.type === "connection" ? `${message.type}:${message.state}` : message.type,
    ),
    ["hello", "connection:connecting", "connection:disconnected"],
  );
  assert.equal(
    messages.some((message) => message.type === "snapshot"),
    false,
  );
  assert.deepEqual(stderr.lines, []);
});

test("stdio protocol rediscovers and emits a fresh snapshot after runtime failure", async () => {
  const controller = new AbortController();
  const stdout = new LineCollector();
  const stderr = new LineCollector();
  const snapshot = runtimeSnapshot({ now: attentionFrame(), next: [], ambient: [] });
  const clients = [fakeRuntimeClient(snapshot), fakeRuntimeClient(snapshot)];
  let connectCount = 0;
  let snapshotCount = 0;

  stdout.onLine = (line) => {
    const message = parseObservedMessage(line);
    if (message.type !== "snapshot") {
      return;
    }
    snapshotCount += 1;
    if (snapshotCount === 1) {
      clients[0]?.fail(new Error("runtime stopped"));
      return;
    }
    controller.abort();
  };

  await runApertureSurfaceStdio({
    packageVersion: "0.5.0",
    label: "omarchy-attention",
    signal: controller.signal,
    stdout,
    stderr,
    dependencies: {
      discover: async () => [runtimeRegistration()],
      connect: async () => {
        const client = clients[connectCount];
        assert.ok(client);
        connectCount += 1;
        return client;
      },
      delay: async () => {},
    },
  });

  const messages = stdout.lines.map(parseObservedMessage);
  assert.deepEqual(
    messages.map((message) =>
      message.type === "connection" ? `${message.type}:${message.state}` : message.type,
    ),
    [
      "hello",
      "connection:connecting",
      "connection:connected",
      "snapshot",
      "connection:disconnected",
      "connection:connecting",
      "connection:connected",
      "snapshot",
    ],
  );
  assert.equal(connectCount, 2);
  assert.equal(
    clients.every((client) => client.closed),
    true,
  );
  assert.deepEqual(stderr.lines, []);
});

type ObservedMessage = {
  type: string;
  state?: string;
  packageVersion?: string;
};

function parseObservedMessage(line: string): ObservedMessage {
  const value: unknown = JSON.parse(line);
  assert.ok(value && typeof value === "object" && "type" in value);
  assert.equal(typeof value.type, "string");
  const state = "state" in value ? value.state : undefined;
  assert.ok(state === undefined || typeof state === "string");
  const packageVersion = "packageVersion" in value ? value.packageVersion : undefined;
  assert.ok(packageVersion === undefined || typeof packageVersion === "string");
  return {
    type: value.type,
    ...(state !== undefined ? { state } : {}),
    ...(packageVersion !== undefined ? { packageVersion } : {}),
  };
}

function attentionFrame(): AttentionFrame {
  return {
    id: "frame-1",
    taskId: "task-1",
    interactionId: "interaction-1",
    version: 1,
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Review the migration",
    summary: "The agent is waiting before changing the development database.",
    source: { id: "codex", kind: "codex", label: "Codex" },
    context: {
      items: [{ id: "project", label: "Project", value: "aperture" }],
    },
    provenance: { whyNow: "Review unblocks the next implementation step." },
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    timing: {
      createdAt: "2026-08-30T16:00:00.000Z",
      updatedAt: "2026-08-30T16:01:00.000Z",
    },
    metadata: { secret: "private-value" },
  };
}

function runtimeSnapshot(attentionView: AttentionView): ApertureRuntimeSnapshot {
  return {
    ...createEmptyRuntimeSnapshot(),
    version: 1,
    attentionView,
    adapters: [
      {
        id: "adapter-1",
        kind: "codex",
        label: "Codex",
        metadata: { secret: "private-value" },
        connectedAt: "2026-08-30T15:00:00.000Z",
        lastSeenAt: "2026-08-30T16:01:00.000Z",
      },
    ],
  };
}

function runtimeRegistration(): ApertureLocalRuntimeRegistration {
  return {
    id: "runtime-1",
    kind: "aperture",
    controlUrl: "http://127.0.0.1:4546/runtime",
    tokenPath: "/private/runtime-token",
    pid: 1234,
    startedAt: "2026-08-30T15:00:00.000Z",
    updatedAt: "2026-08-30T16:01:00.000Z",
  };
}

function fakeRuntimeClient(snapshot: ApertureRuntimeSnapshot): ApertureSurfaceRuntimeClient & {
  readonly closed: boolean;
  fail(error: Error): void;
} {
  let closed = false;
  let errorListener: ((error: Error) => void) | null = null;
  return {
    get closed() {
      return closed;
    },
    fail(error) {
      errorListener?.(error);
    },
    getSnapshot: () => structuredClone(snapshot),
    subscribeSnapshot: (listener) => {
      listener(structuredClone(snapshot));
      return () => {};
    },
    onError: (listener) => {
      errorListener = listener;
      return () => {
        if (errorListener === listener) {
          errorListener = null;
        }
      };
    },
    close: async () => {
      closed = true;
    },
  };
}
