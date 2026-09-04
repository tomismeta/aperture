import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import type { AttentionSignal } from "@tomismeta/aperture-core";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  NOTIFICATION_CORE_TITLE,
  NOTIFICATION_PUBLIC_SUMMARY,
  mapNotificationToSourceEvent,
  matchNotificationIdentity,
  redactNotificationText,
  type NotificationWorkerIdentity,
} from "../src/notification-worker/adapter.js";
import {
  loadNotificationWorkerConfig,
  notificationWorkerPaths,
} from "../src/notification-worker/config.js";
import { NotificationWorkerEngine } from "../src/notification-worker/engine.js";
import {
  APERTURE_NOTIFICATION_WORKER_LIMITS,
  NotificationWorkerProtocolError,
  parseNotificationWorkerInput,
  serializeNotificationWorkerOutput,
  type NotificationWorkerInput,
  type NotificationWorkerOutput,
} from "../src/notification-worker/protocol.js";
import {
  emptyNotificationWorkerState,
  loadNotificationWorkerState,
  NOTIFICATION_WORKER_STATE_LIMITS,
  notificationWorkerRecordCount,
  pruneNotificationWorkerState,
  saveNotificationWorkerState,
} from "../src/notification-worker/state-store.js";
import { runNotificationWorkerStdio } from "../src/notification-worker/stdio.js";

const identity: NotificationWorkerIdentity = {
  id: "agent-test",
  kind: "test-agent",
  label: "Test Agent",
  applicationNames: ["Test Agent"],
  desktopEntries: ["dev.test.Agent"],
};
const observedAt = "2026-08-30T16:00:00.000Z";

function notificationInput(
  overrides: Partial<NotificationWorkerInput> = {},
): NotificationWorkerInput {
  return {
    type: "notification.observed",
    key: "generation-1:notification-7",
    occurredAt: observedAt,
    application: { name: "Test Agent", desktopEntry: "dev.test.Agent" },
    summary: "Review the completed migration",
    body: "Details are available in /Users/tom/private/project?token=secret",
    urgency: "critical",
    ...overrides,
  } as NotificationWorkerInput;
}

function persistedFeedbackSignal(
  key: string,
  timestamp: string,
): Extract<AttentionSignal, { kind: "dismissed" }> {
  const keyHash = createHash("sha256").update(key).digest("hex").slice(0, 24);
  const taskId = `desktop-notification:${identity.id}:${keyHash}`;
  return {
    kind: "dismissed",
    taskId,
    interactionId: `interaction:${taskId}:status`,
    timestamp,
    surface: "omarchy-notifications",
  };
}

test("notification worker schemas validate canonical input and output", async () => {
  const inputSchema = JSON.parse(
    await readFile(
      new URL("../src/notification-worker-input.schema.json", import.meta.url),
      "utf8",
    ),
  ) as object;
  const outputSchema = JSON.parse(
    await readFile(
      new URL("../src/notification-worker-output.schema.json", import.meta.url),
      "utf8",
    ),
  ) as object;
  const surfaceSchema = JSON.parse(
    await readFile(new URL("../src/surface-protocol.schema.json", import.meta.url), "utf8"),
  ) as object;
  const ompAttentionSchema = JSON.parse(
    await readFile(new URL("../src/omp-attention-event.schema.json", import.meta.url), "utf8"),
  ) as object;
  const snapshot = JSON.parse(
    await readFile(
      new URL("../fixtures/omp-direct/snapshot-now-next.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  ajv.addSchema(surfaceSchema);
  const validateInput = ajv.compile(inputSchema);
  const validateOutput = ajv.compile(outputSchema);
  const validateOmpAttention = ajv.compile(ompAttentionSchema);
  assert.equal(validateInput(notificationInput()), true, JSON.stringify(validateInput.errors));
  assert.equal(
    validateInput({
      type: "notification.closed",
      key: "key",
      occurredAt: observedAt,
      reason: "unknown",
    }),
    true,
    JSON.stringify(validateInput.errors),
  );
  assert.equal(validateInput({ type: "shutdown" }), true, JSON.stringify(validateInput.errors));
  assert.equal(
    validateInput({
      type: "focus.activate",
      requestId: "focus-request-1",
      handle: "A23456789_-bcdefghijklmnopqrstuv",
    }),
    true,
    JSON.stringify(validateInput.errors),
  );
  assert.equal(validateInput({ ...notificationInput(), unexpected: true }), false);
  assert.equal(
    validateOutput({
      type: "hello",
      protocolVersion: 4,
      packageVersion: "0.5.0",
      worker: "aperture-attention-engine",
      capabilities: {
        notificationInput: true,
        ompDirectInput: true,
        snapshots: true,
        responses: false,
        focusActivation: true,
      },
    }),
    true,
    JSON.stringify(validateOutput.errors),
  );
  assert.equal(
    validateOutput({
      type: "hello",
      protocolVersion: 4,
      packageVersion: "0.10.0",
      worker: "aperture-attention-engine",
      capabilities: {
        notificationInput: false,
        ompDirectInput: true,
        snapshots: true,
        responses: false,
        focusActivation: true,
      },
    }),
    true,
    JSON.stringify(validateOutput.errors),
  );
  assert.equal(
    validateOutput({
      type: "hello",
      protocolVersion: 3,
      packageVersion: "0.5.0",
      worker: "aperture-attention-engine",
      capabilities: {
        notificationInput: true,
        ompDirectInput: true,
        snapshots: true,
        responses: false,
        focusActivation: true,
      },
    }),
    false,
  );
  assert.equal(
    validateOutput({ type: "engine", state: "ready", acceptedSources: 1 }),
    true,
    JSON.stringify(validateOutput.errors),
  );
  assert.equal(
    validateOutput({ type: "error", code: "invalid_input", message: "invalid", recoverable: true }),
    true,
    JSON.stringify(validateOutput.errors),
  );
  assert.equal(
    validateOutput({
      type: "focus.result",
      requestId: "focus-request-1",
      result: "focused",
    }),
    true,
    JSON.stringify(validateOutput.errors),
  );
  assert.equal(validateOutput(snapshot), true, JSON.stringify(validateOutput.errors));
  assert.equal(
    validateOmpAttention({
      schemaVersion: 3,
      type: "omp.attention-event",
      eventId: "event-1",
      occurredAt: observedAt,
      sessionId: "session-1",
      interactionId: "interaction-1",
      classification: "approval_requested",
      title: "OMP needs approval",
      summary: "OMP is waiting for an operator decision.",
      transition: "requested",
    }),
    true,
    JSON.stringify(validateOmpAttention.errors),
  );
  assert.equal(
    validateOmpAttention({
      schemaVersion: 3,
      type: "omp.attention-event",
      eventId: "event-1",
      occurredAt: observedAt,
      sessionId: "session-1",
      interactionId: "interaction-1",
      classification: "approval_requested",
      title: "OMP needs approval",
      summary: "OMP is waiting for an operator decision.",
      transition: "requested",
      prompt: "private",
    }),
    false,
  );
  assert.equal(validateOutput({ type: "engine", state: "unknown", acceptedSources: 1 }), false);
});

test("notification worker output is ASCII-only and capped after Unicode escaping", () => {
  const message: NotificationWorkerOutput = {
    type: "error",
    code: "unicode",
    message: "Résumé 😀",
    recoverable: true,
  };
  const serialized = serializeNotificationWorkerOutput(message);
  assert.match(serialized, /^[\u0000-\u007f]+$/);
  assert.match(serialized, /R\\u00e9sum\\u00e9 \\ud83d\\ude00/);
  assert.deepEqual(JSON.parse(serialized), message);
  assert.equal(serialized.endsWith("\n"), true);

  assert.throws(
    () =>
      serializeNotificationWorkerOutput({
        type: "error",
        code: "oversized",
        message: "é".repeat(APERTURE_NOTIFICATION_WORKER_LIMITS.outputLineBytes),
        recoverable: false,
      }),
    /output exceeded the byte limit/,
  );
});
test("notification worker input parser accepts the closed fact contract", () => {
  const parsed = parseNotificationWorkerInput(JSON.stringify(notificationInput()));
  assert.equal(parsed.type, "notification.observed");
  assert.throws(
    () =>
      parseNotificationWorkerInput(JSON.stringify({ ...notificationInput(), unexpected: "field" })),
    NotificationWorkerProtocolError,
  );
  assert.throws(
    () =>
      parseNotificationWorkerInput(
        JSON.stringify({ ...notificationInput(), occurredAt: "2026-08-30" }),
      ),
    /canonical ISO timestamp/,
  );
  assert.throws(
    () =>
      parseNotificationWorkerInput(
        JSON.stringify({ ...notificationInput(), body: "é".repeat(4_097) }),
      ),
    /body exceeded the byte limit/,
  );
});

test("notification identity matching is exact and unknown apps fail closed", () => {
  const accepted = notificationInput();
  assert.equal(
    matchNotificationIdentity(
      accepted as Extract<NotificationWorkerInput, { type: "notification.observed" }>,
      [identity],
    )?.id,
    identity.id,
  );
  const unknown = notificationInput({
    application: { name: "Test Agent Helper" },
  }) as Extract<NotificationWorkerInput, { type: "notification.observed" }>;
  assert.equal(matchNotificationIdentity(unknown, [identity]), null);
  const caseChanged = notificationInput({
    application: { name: "test agent" },
  }) as Extract<NotificationWorkerInput, { type: "notification.observed" }>;
  assert.equal(matchNotificationIdentity(caseChanged, [identity]), null);
  assert.equal(mapNotificationToSourceEvent(unknown, [identity]), null);
});

test("notification mapping stays Ambient and persists no raw body", () => {
  const input = notificationInput() as Extract<
    NotificationWorkerInput,
    { type: "notification.observed" }
  >;
  const mapped = mapNotificationToSourceEvent(input, [identity]);
  assert.ok(mapped);
  assert.equal(mapped.sourceEvent.type, "task.updated");
  assert.equal(mapped.sourceEvent.status, "waiting");
  assert.equal(mapped.displayTitle, "Review the completed migration");
  assert.equal(mapped.sourceEvent.title, NOTIFICATION_CORE_TITLE);
  assert.match(String(mapped.sourceEvent.summary), /^Desktop notification event [a-f0-9]{24}$/);
  assert.doesNotMatch(
    JSON.stringify(mapped),
    /private\/project|token=secret|Details are available/,
  );
});

test("unstructured notification prose cannot exceed Ambient posture", async () => {
  const summaries = [
    "Build failed and cannot continue",
    "Approval required: allow command?",
    "Blocked waiting for your input",
    "Permission needed immediately",
    "Critical urgent action required",
    "Same issue as before; this supersedes the previous request",
  ];
  for (const [index, summary] of summaries.entries()) {
    const root = await mkdtemp(path.join(os.tmpdir(), "aperture-worker-posture-"));
    const restored = await NotificationWorkerEngine.restore({
      identities: [identity],
      stateDir: root,
      now: () => Date.parse(observedAt),
    });
    await restored.engine.handle(
      notificationInput({
        key: `posture-${index}`,
        summary,
        urgency: "critical",
      }),
    );
    const snapshot = restored.engine.snapshot();
    assert.equal(snapshot.view.now, null, summary);
    assert.deepEqual(snapshot.view.next, [], summary);
    assert.equal(snapshot.view.ambient.length, 1, summary);
    assert.equal(snapshot.view.ambient[0]?.title, summary);
    assert.equal(snapshot.view.ambient[0]?.summary, NOTIFICATION_PUBLIC_SUMMARY);
    assert.equal(snapshot.view.ambient[0]?.tone, "ambient");
    assert.equal(snapshot.view.ambient[0]?.consequence, "low");
    assert.equal(snapshot.view.ambient[0]?.provenance, undefined);

    const persisted = JSON.parse(await readFile(path.join(root, "state.json"), "utf8")) as {
      active: Array<{
        revisions: Array<{
          displayTitle: string;
          sourceEvent: { title: string; summary: string };
        }>;
      }>;
    };
    const revision = persisted.active[0]?.revisions.at(-1);
    assert.equal(revision?.displayTitle, summary);
    assert.equal(revision?.sourceEvent.title, NOTIFICATION_CORE_TITLE);
    assert.match(revision?.sourceEvent.summary ?? "", /^Desktop notification event /);
    assert.equal(JSON.stringify(revision?.sourceEvent).includes(summary), false);
  }
});

test("notification redaction removes common secret and private-path forms", () => {
  const redacted = redactNotificationText(
    "Bearer abc.def token=secret /Users/tom/project https://host/path?q=secret#fragment",
    400,
  );
  assert.match(redacted, /Bearer \[redacted\]/);
  assert.match(redacted, /token=\[redacted\]/);
  assert.match(redacted, /\[private-path\]/);
  assert.equal(redacted.includes("q=secret"), false);
  assert.equal(redacted.includes("#fragment"), false);
});

test("worker config uses XDG paths and exact reviewed aliases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-worker-config-"));
  const configPath = path.join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, identities: [identity] }), "utf8");
  const config = await loadNotificationWorkerConfig(configPath);
  assert.equal(config.identities[0]?.id, identity.id);
  assert.deepEqual(notificationWorkerPaths({ HOME: "/home/test" }), {
    configPath: "/home/test/.config/omarchy/aperture/config.json",
    stateDir: "/home/test/.local/state/omarchy/aperture",
  });
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      identities: [
        identity,
        {
          id: "agent-other",
          kind: "other-agent",
          label: "Other Agent",
          applicationNames: ["Test Agent"],
        },
      ],
    }),
    "utf8",
  );
  await assert.rejects(loadNotificationWorkerConfig(configPath), /alias .* is shared/);
  await writeFile(configPath, " ".repeat(256 * 1024 + 1), "utf8");
  await assert.rejects(loadNotificationWorkerConfig(configPath), /byte limit/);
});

test("state persistence is private bounded and recovers corrupt files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-worker-state-"));
  const signals: AttentionSignal[] = Array.from(
    { length: NOTIFICATION_WORKER_STATE_LIMITS.maximumRecords + 10 },
    (_, index) =>
      persistedFeedbackSignal(
        `key-${index}`,
        new Date(Date.parse(observedAt) + index).toISOString(),
      ),
  );
  const expiredSignal = persistedFeedbackSignal(
    "expired-key",
    new Date(
      Date.parse(observedAt) - NOTIFICATION_WORKER_STATE_LIMITS.maximumAgeMs - 1,
    ).toISOString(),
  );
  signals.unshift(expiredSignal);
  const bounded = pruneNotificationWorkerState(
    { schemaVersion: 1, active: [], signals },
    Date.parse(observedAt) + signals.length,
  );
  assert.equal(bounded.signals.length, NOTIFICATION_WORKER_STATE_LIMITS.maximumRecords);
  assert.equal(
    bounded.signals.some((signal) => signal.taskId === expiredSignal.taskId),
    false,
  );
  await saveNotificationWorkerState(root, bounded, Date.parse(observedAt) + signals.length);
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(root, "state.json"))).mode & 0o777, 0o600);
  assert.ok(
    Buffer.byteLength(await readFile(path.join(root, "state.json"), "utf8"), "utf8") <=
      NOTIFICATION_WORKER_STATE_LIMITS.maximumBytes,
  );

  const staleOnDisk = JSON.parse(await readFile(path.join(root, "state.json"), "utf8")) as {
    signals: AttentionSignal[];
  };
  staleOnDisk.signals.unshift(expiredSignal);
  await writeFile(path.join(root, "state.json"), JSON.stringify(staleOnDisk), { mode: 0o600 });
  const prunedLoad = await loadNotificationWorkerState(
    root,
    Date.parse(observedAt) + signals.length,
  );
  assert.equal(prunedLoad.recoveredCorruptState, false);
  assert.equal(
    (await readFile(path.join(root, "state.json"), "utf8")).includes(expiredSignal.taskId),
    false,
  );

  const tampered = JSON.parse(await readFile(path.join(root, "state.json"), "utf8")) as {
    signals: Array<Record<string, unknown>>;
  };
  if (tampered.signals[0]) tampered.signals[0].rawBody = "must not survive";
  await writeFile(path.join(root, "state.json"), JSON.stringify(tampered), { mode: 0o600 });
  await writeFile(path.join(root, ".state-deadbeef.tmp"), "stale", { mode: 0o600 });
  const recovered = await loadNotificationWorkerState(root, Date.parse(observedAt));
  assert.equal(recovered.recoveredCorruptState, true);
  assert.deepEqual(recovered.state, emptyNotificationWorkerState());
  await assert.rejects(() => readFile(path.join(root, "state.json"), "utf8"), { code: "ENOENT" });
  await assert.rejects(() => readFile(path.join(root, ".state-deadbeef.tmp"), "utf8"), {
    code: "ENOENT",
  });
});

test("revision ledger evicts oldest replacement facts deterministically", () => {
  const revisionCount = NOTIFICATION_WORKER_STATE_LIMITS.maximumRecords + 10;
  const mapped = Array.from({ length: revisionCount }, (_, index) => {
    const event = mapNotificationToSourceEvent(
      notificationInput({
        key: "bounded-revision-key",
        occurredAt: new Date(Date.parse(observedAt) + index).toISOString(),
        summary: `Revision ${index}`,
      }) as Extract<NotificationWorkerInput, { type: "notification.observed" }>,
      [identity],
    );
    assert.ok(event);
    return event;
  });
  const first = mapped[0]!;
  const bounded = pruneNotificationWorkerState(
    {
      schemaVersion: 1,
      active: [
        {
          key: first.key,
          taskId: first.taskId,
          interactionId: first.interactionId,
          revisions: mapped.map((entry) => ({
            occurredAt: entry.occurredAt,
            displayTitle: entry.displayTitle,
            sourceEvent: entry.sourceEvent,
          })),
        },
      ],
      signals: [],
    },
    Date.parse(observedAt) + revisionCount,
  );
  assert.equal(
    notificationWorkerRecordCount(bounded),
    NOTIFICATION_WORKER_STATE_LIMITS.maximumRecords,
  );
  assert.equal(bounded.active[0]?.revisions[0]?.displayTitle, "Revision 10");
  assert.equal(bounded.active[0]?.revisions.at(-1)?.displayTitle, `Revision ${revisionCount - 1}`);
});

test("stateful worker emits deterministic Ambient state and clears on close", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-worker-engine-"));
  const restored = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => Date.parse(observedAt),
  });
  await restored.engine.handle(notificationInput());
  const active = restored.engine.snapshot();
  assert.equal(active.view.now, null);
  assert.equal(active.view.next.length, 0);
  await restored.engine.handle(
    notificationInput({
      key: "expired-notification",
      occurredAt: new Date(
        Date.parse(observedAt) - NOTIFICATION_WORKER_STATE_LIMITS.maximumAgeMs - 1,
      ).toISOString(),
      summary: "Expired notification",
    }),
  );
  assert.equal(restored.engine.snapshot().view.ambient.length, 1);
  assert.equal(active.view.ambient.length, 1);
  assert.equal(active.view.ambient[0]?.title, "Review the completed migration");
  assert.doesNotMatch(
    await readFile(path.join(root, "state.json"), "utf8"),
    /private\/project|Details are available/,
  );

  const replayed = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => Date.parse(observedAt),
  });
  assert.deepEqual(replayed.engine.snapshot().view, active.view);

  await replayed.engine.handle({
    type: "notification.closed",
    key: "generation-1:notification-7",
    occurredAt: "2026-08-30T16:01:00.000Z",
    reason: "expired",
  });
  assert.equal(replayed.engine.snapshot().view.ambient.length, 0);
});

test("stdio worker emits hello state snapshots and bounded errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-worker-stdio-"));
  const lines = [
    JSON.stringify(notificationInput()),
    JSON.stringify(notificationInput()),
    "x".repeat(APERTURE_NOTIFICATION_WORKER_LIMITS.inputLineBytes),
    "{malformed",
    JSON.stringify({
      type: "focus.activate",
      requestId: "missing-focus",
      handle: "A23456789_-bcdefghijklmnopqrstuv",
    }),
    JSON.stringify({ type: "shutdown" }),
  ];
  let output = "";
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  await runNotificationWorkerStdio({
    packageVersion: "0.5.0",
    identities: [identity],
    stateDir: root,
    input: Readable.from(lines.map((line) => `${line}\n`)),
    output: writable,
    diagnostic: writable,
    now: () => Date.parse(observedAt),
  });
  const messages = output
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          type?: string;
          protocolVersion?: number;
          code?: string;
          requestId?: string;
          result?: string;
        },
    );
  assert.equal(messages[0]?.type, "hello");
  assert.equal(messages[0]?.protocolVersion, 4);
  assert.equal(
    messages.some((message) => message.type === "engine"),
    true,
  );
  assert.equal(messages.filter((message) => message.type === "snapshot").length, 2);
  assert.equal(messages.filter((message) => message.code === "invalid_input").length, 2);
  assert.deepEqual(
    messages.find((message) => message.type === "focus.result"),
    {
      type: "focus.result",
      requestId: "missing-focus",
      result: "missing",
    },
  );
});
