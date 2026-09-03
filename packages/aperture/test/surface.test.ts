import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import type { AttentionFrame, AttentionView } from "@tomismeta/aperture-core";
import type {
  ApertureLocalRuntimeRegistration,
  ApertureRuntimeClientOptions,
  ApertureRuntimeSnapshot,
} from "@aperture/runtime";
import { createEmptyRuntimeSnapshot } from "../../runtime/src/runtime-client-shared.js";
import { assertApertureSurfaceMessage } from "../src/surface/protocol-validator.js";
import {
  APERTURE_STDIO_CAPABILITIES,
  APERTURE_SURFACE_LIMITS,
  serializeApertureSurfaceMessage,
  type ApertureSurfaceMessage,
} from "../src/surface/protocol.js";
import { projectSurfaceSnapshot } from "../src/surface/projection.js";
import {
  runApertureSurfaceSession,
  type ApertureSurfaceRuntimeClient,
} from "../src/surface/runtime-session.js";
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

class BrokenPipeWritable extends Writable {
  override _write(
    _chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback(Object.assign(new Error("broken pipe"), { code: "EPIPE" }));
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
  assert.equal("navigation" in (projected.view.now ?? {}), false);
});

test("surface projection preserves opaque identity and normalizes display data", () => {
  const frame = {
    ...attentionFrame(),
    id: " frame:opaque ",
    source: { id: "source-fallback", kind: "   ", label: "   " },
    timing: {
      createdAt: "2026-08-30T16:00:00+00:00",
      updatedAt: "2026-08-30T16:01:00+00:00",
    },
  };
  const snapshot = runtimeSnapshot({ now: frame, next: [], ambient: [] });
  const adapter = snapshot.adapters[0];
  assert.ok(adapter);
  adapter.label = "   ";

  const projected = projectSurfaceSnapshot(snapshot, 1);
  assert.equal(projected.sources[0]?.label, "codex");
  assert.equal(projected.view.now?.id, " frame:opaque ");
  assert.equal(projected.view.now?.source?.kind, "unknown");
  assert.equal(projected.view.now?.source?.label, "source-fallback");
  assert.equal(projected.view.now?.timing.createdAt, "2026-08-30T16:00:00.000Z");

  const oversized = {
    ...frame,
    id: "x".repeat(APERTURE_SURFACE_LIMITS.id + 1),
  };
  assert.throws(
    () => projectSurfaceSnapshot(runtimeSnapshot({ now: oversized, next: [], ambient: [] }), 2),
    /identifier limit/,
  );
});

test("surface validator applies strict RFC3339 date-time semantics without ajv-formats", () => {
  const projected = projectSurfaceSnapshot(
    runtimeSnapshot({ now: attentionFrame(), next: [], ambient: [] }),
    1,
  );
  const validOffset = structuredClone(projected);
  assert.ok(validOffset.view.now);
  validOffset.view.now.timing.createdAt = "2026-08-30T16:00:00+02:30";
  assert.doesNotThrow(() => assertApertureSurfaceMessage(validOffset));

  for (const timestamp of [
    "2026-02-30T16:00:00Z",
    "2026-08-30 16:00:00Z",
    "2026-08-30T24:00:00Z",
    "2026-08-30T16:00:00+24:00",
  ]) {
    const invalid = structuredClone(projected);
    assert.ok(invalid.view.now);
    invalid.view.now.timing.createdAt = timestamp;
    assert.throws(() => assertApertureSurfaceMessage(invalid));
  }
});

test("surface projection discloses totals while fitting an ordered prefix under 256 KiB", () => {
  const frames = Array.from({ length: APERTURE_SURFACE_LIMITS.ambientFrames }, (_, index) => ({
    ...attentionFrame(),
    id: `frame-${index}`,
    taskId: `task-${index}`,
    interactionId: `interaction-${index}`,
    title: "😀".repeat(APERTURE_SURFACE_LIMITS.title),
    summary: "界".repeat(APERTURE_SURFACE_LIMITS.summary),
    context: {
      items: Array.from({ length: APERTURE_SURFACE_LIMITS.contextItems }, (__, itemIndex) => ({
        id: `context-${index}-${itemIndex}`,
        label: "界".repeat(APERTURE_SURFACE_LIMITS.label),
        value: "😀".repeat(APERTURE_SURFACE_LIMITS.contextValue),
      })),
    },
    provenance: { whyNow: "界".repeat(APERTURE_SURFACE_LIMITS.whyNow) },
  }));
  const projected = projectSurfaceSnapshot(
    runtimeSnapshot({
      now: frames[0] ?? null,
      next: frames.slice(0, APERTURE_SURFACE_LIMITS.nextFrames),
      ambient: frames,
    }),
    1,
  );

  assert.ok(
    serializeApertureSurfaceMessage(projected).length <= APERTURE_SURFACE_LIMITS.jsonLineBytes,
  );
  assert.equal(projected.totals.next, APERTURE_SURFACE_LIMITS.nextFrames);
  assert.ok(projected.totals.sources >= projected.sources.length);
  assert.equal(projected.totals.ambient, APERTURE_SURFACE_LIMITS.ambientFrames);
  assert.ok(projected.view.ambient.length < projected.totals.ambient);
  assert.deepEqual(
    projected.view.ambient.map((frame) => frame.id),
    frames.slice(0, projected.view.ambient.length).map((frame) => frame.id),
  );
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
    "snapshot-minimal.json",
    "snapshot-now.json",
  ]);

  for (const fixtureName of fixtureNames) {
    const raw = await readFile(new URL(fixtureName, fixtureDirectory), "utf8");
    const value: unknown = JSON.parse(raw);
    assertApertureSurfaceMessage(value);
    assert.ok(value && typeof value === "object" && "type" in value, `${fixtureName} type`);
    assert.equal(typeof value.type, "string");
    if (value.type === "hello") {
      assert.ok("protocolVersion" in value);
      assert.equal(value.protocolVersion, 4);
    }
    assert.doesNotMatch(raw, /metadata|responseSpec|tokenPath|controlUrl|authToken/);

    if (value.type === "snapshot") {
      assert.ok("sources" in value && Array.isArray(value.sources));
      for (const source of value.sources) {
        assert.ok(source && typeof source === "object");
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
  assert.doesNotMatch(schemaRaw, /navigation|opaque-focus/);
});

test("stdio protocol emits hello, connection, and a complete companion snapshot in order", async () => {
  const controller = new AbortController();
  const stdout = new LineCollector();
  const stderr = new LineCollector();
  const frame = attentionFrame();
  frame.title = "Résumé 🚀";
  const snapshot = runtimeSnapshot({ now: frame, next: [], ambient: [] });
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
  assert.equal(messages[0]?.protocolVersion, 4);
  const helloValue: unknown = JSON.parse(stdout.lines[0] ?? "");
  assert.ok(helloValue && typeof helloValue === "object" && "capabilities" in helloValue);
  assert.deepEqual(Object.keys(helloValue).sort(), [
    "capabilities",
    "packageVersion",
    "protocolVersion",
    "surface",
    "type",
  ]);
  assert.deepEqual(helloValue.capabilities, APERTURE_STDIO_CAPABILITIES);
  assert.equal(
    stdout.lines.every((line) => /^[\x00-\x7f]*$/.test(line)),
    true,
  );
  const emittedSnapshot = stdout.lines
    .map((line) => JSON.parse(line) as ApertureSurfaceMessage)
    .find((message) => message.type === "snapshot");
  assert.equal(emittedSnapshot?.type, "snapshot");
  if (emittedSnapshot?.type === "snapshot") {
    assert.equal(emittedSnapshot.view.now?.title, "Résumé 🚀");
  }
  assert.equal(connectOptions?.surfaceRole, "companion");
  assert.equal(connectOptions?.acceptsResponses, APERTURE_STDIO_CAPABILITIES.responses);
  assert.equal(connectOptions?.signal, controller.signal);
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
  const registrations = [
    runtimeRegistration({
      id: "runtime-1",
      controlUrl: "http://127.0.0.1:4546/runtime",
      tokenPath: "/private/runtime-token-1",
      startedAt: "2026-08-30T15:00:00.000Z",
    }),
    runtimeRegistration({
      id: "runtime-2",
      controlUrl: "http://127.0.0.1:4646/runtime",
      tokenPath: "/private/runtime-token-2",
      startedAt: "2026-08-30T16:00:00.000Z",
    }),
  ];
  const connectionOptions: ApertureRuntimeClientOptions[] = [];
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
      discover: async () => [registrations[Math.min(connectCount, registrations.length - 1)]!],
      connect: async (options) => {
        connectionOptions.push(options);
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
  assert.deepEqual(
    connectionOptions.map((options) => options.baseUrl),
    ["http://127.0.0.1:4546/runtime", "http://127.0.0.1:4646/runtime"],
  );
  assert.equal(
    clients.every((client) => client.closed),
    true,
  );
  assert.deepEqual(stderr.lines, []);
});

test("surface re-emits a recovered projection even when it matches the last valid view", async () => {
  const controller = new AbortController();
  const validSnapshot = runtimeSnapshot({ now: attentionFrame(), next: [], ambient: [] });
  const malformedFrame = {
    ...attentionFrame(),
    timing: {
      createdAt: "not-a-timestamp",
      updatedAt: "2026-08-30T16:01:00.000Z",
    },
  };
  const malformedSnapshot = runtimeSnapshot({
    now: malformedFrame,
    next: [],
    ambient: [],
  });
  const client = fakeRuntimeClient(validSnapshot);
  const observed: ApertureSurfaceMessage[] = [];
  let snapshots = 0;

  await runApertureSurfaceSession({
    label: "recovery-test",
    signal: controller.signal,
    emit: async (message) => {
      observed.push(message);
      if (message.type === "snapshot") {
        snapshots += 1;
        if (snapshots === 1) client.emit(malformedSnapshot);
        else controller.abort();
        return;
      }
      if (message.type === "error" && message.code === "surface_projection_failed") {
        client.emit(validSnapshot);
      }
    },
    dependencies: {
      discover: async () => [runtimeRegistration()],
      connect: async () => client,
      delay: async () => controller.abort(),
    },
  });

  assert.deepEqual(
    observed.map((message) =>
      message.type === "connection" ? `${message.type}:${message.state}` : message.type,
    ),
    ["connection:connecting", "connection:connected", "snapshot", "error", "snapshot"],
  );
  assert.deepEqual(
    observed
      .filter(
        (message): message is Extract<ApertureSurfaceMessage, { type: "snapshot" }> =>
          message.type === "snapshot",
      )
      .map((message) => message.sequence),
    [1, 2],
  );
  assert.equal(client.closed, true);
});

test("surface emits changed overflow totals when the bounded view is unchanged", async () => {
  const controller = new AbortController();
  const ambient = Array.from({ length: APERTURE_SURFACE_LIMITS.ambientFrames + 1 }, (_, index) => ({
    ...attentionFrame(),
    id: `ambient-frame-${index}`,
    taskId: `ambient-task-${index}`,
    interactionId: `ambient-interaction-${index}`,
  }));
  const client = fakeRuntimeClient(
    runtimeSnapshot({
      now: null,
      next: [],
      ambient: ambient.slice(0, APERTURE_SURFACE_LIMITS.ambientFrames),
    }),
  );
  const ambientTotals: number[] = [];

  await runApertureSurfaceSession({
    label: "totals-test",
    signal: controller.signal,
    emit: async (message) => {
      if (message.type !== "snapshot") return;
      ambientTotals.push(message.totals.ambient);
      if (ambientTotals.length === 1) {
        client.emit(runtimeSnapshot({ now: null, next: [], ambient }));
      } else {
        controller.abort();
      }
    },
    dependencies: {
      discover: async () => [runtimeRegistration()],
      connect: async () => client,
      delay: async () => controller.abort(),
    },
  });

  assert.deepEqual(ambientTotals, [
    APERTURE_SURFACE_LIMITS.ambientFrames,
    APERTURE_SURFACE_LIMITS.ambientFrames + 1,
  ]);
});

test("surface coalesces snapshot bursts behind a slow consumer", async () => {
  const controller = new AbortController();
  const client = fakeRuntimeClient(
    runtimeSnapshot({ now: attentionFrame(), next: [], ambient: [] }),
  );
  const firstSnapshotStarted = deferred<void>();
  const releaseFirstSnapshot = deferred<void>();
  const observed: Array<{ sequence: number; title: string | undefined }> = [];

  const running = runApertureSurfaceSession({
    label: "backpressure-test",
    signal: controller.signal,
    emit: async (message) => {
      if (message.type !== "snapshot") return;
      observed.push({ sequence: message.sequence, title: message.view.now?.title });
      if (observed.length === 1) {
        firstSnapshotStarted.resolve(undefined);
        await releaseFirstSnapshot.promise;
      } else {
        controller.abort();
      }
    },
    dependencies: {
      discover: async () => [runtimeRegistration()],
      connect: async () => client,
      delay: async () => controller.abort(),
    },
  });

  await firstSnapshotStarted.promise;
  for (let version = 2; version <= 100; version += 1) {
    client.emit(
      runtimeSnapshot({
        now: {
          ...attentionFrame(),
          version,
          title: `Update ${version}`,
        },
        next: [],
        ambient: [],
      }),
    );
  }
  releaseFirstSnapshot.resolve(undefined);
  await running;

  assert.deepEqual(observed, [
    { sequence: 1, title: "Review the migration" },
    { sequence: 100, title: "Update 100" },
  ]);
});

test("surface bounds alternating projection failure and recovery behind backpressure", async () => {
  const controller = new AbortController();
  const client = fakeRuntimeClient(
    runtimeSnapshot({ now: attentionFrame(), next: [], ambient: [] }),
  );
  const firstUpdateStarted = deferred<void>();
  const releaseFirstUpdate = deferred<void>();
  const observed: Array<{ type: string; title?: string }> = [];

  const running = runApertureSurfaceSession({
    label: "alternating-backpressure-test",
    signal: controller.signal,
    emit: async (message) => {
      if (
        message.type !== "snapshot" &&
        !(message.type === "error" && message.code === "surface_projection_failed")
      ) {
        return;
      }
      observed.push({
        type: message.type,
        ...(message.type === "snapshot" ? { title: message.view.now?.title } : {}),
      });
      if (observed.length === 1) {
        firstUpdateStarted.resolve(undefined);
        await releaseFirstUpdate.promise;
      } else if (message.type === "snapshot" && message.view.now?.title === "Recovered 100") {
        controller.abort();
      }
    },
    dependencies: {
      discover: async () => [runtimeRegistration()],
      connect: async () => client,
      delay: async () => controller.abort(),
    },
  });

  await firstUpdateStarted.promise;
  const malformed = runtimeSnapshot({
    now: {
      ...attentionFrame(),
      timing: {
        createdAt: "invalid",
        updatedAt: "2026-08-30T16:01:00.000Z",
      },
    },
    next: [],
    ambient: [],
  });
  for (let version = 2; version < 100; version += 1) {
    client.emit(
      version % 2 === 0
        ? malformed
        : runtimeSnapshot({
            now: {
              ...attentionFrame(),
              version,
              title: `Recovered ${version}`,
            },
            next: [],
            ambient: [],
          }),
    );
  }
  client.emit(
    runtimeSnapshot({
      now: {
        ...attentionFrame(),
        version: 100,
        title: "Recovered 100",
      },
      next: [],
      ambient: [],
    }),
  );
  releaseFirstUpdate.resolve(undefined);
  await running;

  assert.deepEqual(observed, [
    { type: "snapshot", title: "Review the migration" },
    { type: "snapshot", title: "Recovered 100" },
  ]);
});

test("surface aborts an in-flight connection and closes a late client", async () => {
  const controller = new AbortController();
  const client = fakeRuntimeClient(
    runtimeSnapshot({ now: attentionFrame(), next: [], ambient: [] }),
  );
  const connectStarted = deferred<void>();
  const pendingClient = deferred<ApertureSurfaceRuntimeClient>();

  const running = runApertureSurfaceSession({
    label: "abort-test",
    signal: controller.signal,
    emit: async () => {},
    dependencies: {
      discover: async () => [runtimeRegistration()],
      connect: async () => {
        connectStarted.resolve(undefined);
        return pendingClient.promise;
      },
      delay: async () => {},
    },
  });

  await connectStarted.promise;
  controller.abort();
  pendingClient.resolve(client);
  await Promise.race([
    running,
    delay(250).then(() => {
      throw new Error("surface did not stop after aborting an in-flight connection");
    }),
  ]);
  await delay(0);
  assert.equal(client.closed, true);
});

test("surface keeps rapid connection failures on exponential backoff", async () => {
  const controller = new AbortController();
  const snapshot = runtimeSnapshot({ now: attentionFrame(), next: [], ambient: [] });
  const clients = [
    fakeRuntimeClient(snapshot),
    fakeRuntimeClient(snapshot),
    fakeRuntimeClient(snapshot),
  ];
  const delays: number[] = [];
  let connected = 0;
  let snapshots = 0;

  await runApertureSurfaceSession({
    label: "backoff-test",
    signal: controller.signal,
    emit: async (message) => {
      if (message.type !== "snapshot") return;
      snapshots += 1;
      if (snapshots <= 2) {
        clients[snapshots - 1]?.fail(new Error("short session failed"));
      } else {
        controller.abort();
      }
    },
    dependencies: {
      discover: async () => [runtimeRegistration()],
      connect: async () => {
        const client = clients[connected];
        assert.ok(client);
        connected += 1;
        return client;
      },
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    },
  });

  assert.deepEqual(delays, [250, 500]);
});

test("stdio transport rejects EPIPE without an unhandled stream error", async () => {
  const controller = new AbortController();
  await assert.rejects(
    runApertureSurfaceStdio({
      packageVersion: "0.5.0",
      label: "broken-pipe-test",
      signal: controller.signal,
      stdout: new BrokenPipeWritable(),
      stderr: new LineCollector(),
    }),
    /broken pipe/,
  );
});

type ObservedMessage = {
  type: string;
  state?: string;
  packageVersion?: string;
  protocolVersion?: number;
};

function parseObservedMessage(line: string): ObservedMessage {
  const value: unknown = JSON.parse(line);
  assert.ok(value && typeof value === "object" && "type" in value);
  assert.equal(typeof value.type, "string");
  const state = "state" in value ? value.state : undefined;
  assert.ok(state === undefined || typeof state === "string");
  const packageVersion = "packageVersion" in value ? value.packageVersion : undefined;
  assert.ok(packageVersion === undefined || typeof packageVersion === "string");
  const protocolVersion = "protocolVersion" in value ? value.protocolVersion : undefined;
  assert.ok(protocolVersion === undefined || typeof protocolVersion === "number");
  return {
    type: value.type,
    ...(state !== undefined ? { state } : {}),
    ...(packageVersion !== undefined ? { packageVersion } : {}),
    ...(protocolVersion !== undefined ? { protocolVersion } : {}),
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

function runtimeRegistration(
  overrides: Partial<ApertureLocalRuntimeRegistration> = {},
): ApertureLocalRuntimeRegistration {
  return {
    id: "runtime-1",
    kind: "aperture",
    controlUrl: "http://127.0.0.1:4546/runtime",
    tokenPath: "/private/runtime-token",
    pid: 1234,
    startedAt: "2026-08-30T15:00:00.000Z",
    updatedAt: "2026-08-30T16:01:00.000Z",
    ...overrides,
  };
}

function fakeRuntimeClient(snapshot: ApertureRuntimeSnapshot): ApertureSurfaceRuntimeClient & {
  readonly closed: boolean;
  fail(error: Error): void;
  emit(nextSnapshot: ApertureRuntimeSnapshot): void;
} {
  let closed = false;
  let errorListener: ((error: Error) => void) | null = null;
  let snapshotListener: ((snapshot: ApertureRuntimeSnapshot) => void) | null = null;
  return {
    get closed() {
      return closed;
    },
    fail(error) {
      errorListener?.(error);
    },
    emit(nextSnapshot) {
      snapshotListener?.(structuredClone(nextSnapshot));
    },
    subscribeSnapshot: (listener) => {
      snapshotListener = listener;
      listener(structuredClone(snapshot));
      return () => {
        if (snapshotListener === listener) snapshotListener = null;
      };
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

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
