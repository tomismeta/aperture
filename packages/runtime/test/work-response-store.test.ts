import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AttentionResponse } from "@tomismeta/aperture-core";

import { WorkResponseStore } from "../src/work-response-store.js";

test("work response store rejects invalid persisted JSON without rewriting it", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
  const storePath = join(stateDir, "work-responses.json");

  try {
    await writeFile(storePath, "{ definitely not valid json\n", "utf8");
    await assert.rejects(
      () =>
        WorkResponseStore.open({
          stateDir,
          maxEntries: 8,
          pendingTtlMs: 1_000,
          retentionMs: 1_000,
        }),
      /Unable to read persisted work-response state/,
    );
    assert.equal(await readFile(storePath, "utf8"), "{ definitely not valid json\n");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("work response store rejects unsupported persisted versions without rewriting them", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
  const storePath = join(stateDir, "work-responses.json");
  const persisted = JSON.stringify({ schemaVersion: 2, records: [] });

  try {
    await writeFile(storePath, persisted, "utf8");
    await assert.rejects(
      () =>
        WorkResponseStore.open({
          stateDir,
          maxEntries: 8,
          pendingTtlMs: 1_000,
          retentionMs: 1_000,
        }),
      /Unsupported persisted work-response state/,
    );
    assert.equal(await readFile(storePath, "utf8"), persisted);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("work response store rejects malformed records without rewriting them", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
  const storePath = join(stateDir, "work-responses.json");
  const persisted = JSON.stringify({
    schemaVersion: 1,
    records: [
      {
        taskId: "task:deploy-42",
        interactionId: "interaction:deploy-42:approval",
        state: "pending",
        createdAt: "not-a-date",
        updatedAt: "2026-08-13T00:00:00.000Z",
        expiresAt: "2026-08-13T00:01:00.000Z",
      },
    ],
  });

  try {
    await writeFile(storePath, persisted, "utf8");
    await assert.rejects(
      () =>
        WorkResponseStore.open({
          stateDir,
          maxEntries: 8,
          pendingTtlMs: 1_000,
          retentionMs: 1_000,
        }),
      /Invalid persisted work-response record/,
    );
    assert.equal(await readFile(storePath, "utf8"), persisted);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("work response store rejects duplicate interaction ids without rewriting them", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
  const storePath = join(stateDir, "work-responses.json");
  const persisted = JSON.stringify({
    schemaVersion: 1,
    records: [
      {
        taskId: "task:deploy-42",
        interactionId: "interaction:deploy-42:approval",
        state: "pending",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
        expiresAt: "2026-08-13T00:01:00.000Z",
      },
      {
        taskId: "task:duplicate",
        interactionId: "interaction:deploy-42:approval",
        state: "pending",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
        expiresAt: "2026-08-13T00:01:00.000Z",
      },
    ],
  });

  try {
    await writeFile(storePath, persisted, "utf8");
    await assert.rejects(
      () =>
        WorkResponseStore.open({
          stateDir,
          maxEntries: 8,
          pendingTtlMs: 1_000,
          retentionMs: 1_000,
        }),
      /Invalid persisted work-response record/,
    );
    assert.equal(await readFile(storePath, "utf8"), persisted);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("work response store rejects answered records without a valid answer", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
  const storePath = join(stateDir, "work-responses.json");
  const persisted = JSON.stringify({
    schemaVersion: 1,
    records: [
      {
        taskId: "task:invalid-answer",
        interactionId: "interaction:invalid-answer",
        state: "answered",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:01:00.000Z",
        response: { kind: "text_submitted", text: "   " },
        answeredAt: "2026-08-13T00:01:00.000Z",
        retentionExpiresAt: "2026-08-13T00:02:00.000Z",
      },
    ],
  });

  try {
    await writeFile(storePath, persisted, "utf8");
    await assert.rejects(
      () =>
        WorkResponseStore.open({
          stateDir,
          maxEntries: 8,
          pendingTtlMs: 1_000,
          retentionMs: 1_000,
        }),
      /Invalid persisted work-response record/,
    );
    assert.equal(await readFile(storePath, "utf8"), persisted);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("work response store round-trips every valid answer kind", async () => {
  const answers: AttentionResponse["response"][] = [
    { kind: "acknowledged" },
    { kind: "approved", reason: "Looks good." },
    { kind: "rejected", reason: "Needs changes." },
    { kind: "option_selected", optionIds: ["yes"] },
    { kind: "text_submitted", text: "Proceed." },
    { kind: "form_submitted", values: { environment: "production" } },
    { kind: "dismissed" },
  ];

  for (const [index, answer] of answers.entries()) {
    const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
    try {
      const store = await WorkResponseStore.open({
        stateDir,
        maxEntries: 8,
        pendingTtlMs: 1_000,
        retentionMs: 1_000,
      });
      const interactionId = `interaction:answer:${index}`;
      store.registerPending(`task:answer:${index}`, interactionId);
      store.recordAnswered({
        taskId: `task:answer:${index}`,
        interactionId,
        response: answer,
      });
      await store.flush();

      const reloaded = await WorkResponseStore.open({
        stateDir,
        maxEntries: 8,
        pendingTtlMs: 1_000,
        retentionMs: 1_000,
      });
      const record = reloaded.get(interactionId);
      assert.equal(record?.state, "answered");
      if (record?.state !== "answered") throw new Error("Expected an answered response.");
      assert.deepEqual(record.response, answer);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }
});

test("cancelled responses stay terminal across late answers and reload until explicitly republished", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
  let nowMs = Date.parse("2026-10-24T12:00:00.000Z");
  const options = {
    stateDir,
    maxEntries: 8,
    pendingTtlMs: 1_000,
    retentionMs: 2_000,
    timeSource: () => nowMs,
  };
  const answer: AttentionResponse = {
    taskId: "task:cancelled",
    interactionId: "interaction:cancelled",
    response: { kind: "approved" },
  };
  const store = await WorkResponseStore.open(options);
  let reloaded: WorkResponseStore | undefined;

  try {
    store.registerPending(answer.taskId, answer.interactionId);
    store.registerPending(answer.taskId, "interaction:sibling");
    nowMs += 10;
    const cancelled = store.cancel(answer.interactionId);
    assert.equal(cancelled?.state, "cancelled");

    nowMs += 10;
    assert.deepEqual(store.recordAnswered(answer), cancelled);
    assert.deepEqual(store.cancel(answer.interactionId), cancelled);
    assert.deepEqual(store.get(answer.interactionId), cancelled);
    assert.equal(store.get("interaction:sibling")?.state, "pending");
    assert.equal(
      store.recordAnswered({ ...answer, interactionId: "interaction:sibling" })?.state,
      "answered",
    );
    await store.flush();

    reloaded = await WorkResponseStore.open(options);
    nowMs += 10;
    assert.deepEqual(reloaded.recordAnswered(answer), cancelled);
    assert.deepEqual(reloaded.get(answer.interactionId), cancelled);
    assert.equal(reloaded.get("interaction:sibling")?.state, "answered");

    const pending = reloaded.registerPending(answer.taskId, answer.interactionId);
    assert.equal(pending.state, "pending");
    assert.equal("cancelledAt" in pending, false);
    assert.equal("retentionExpiresAt" in pending, false);
    assert.equal(reloaded.recordAnswered({ ...answer, taskId: "task:wrong" }), null);
    assert.deepEqual(reloaded.get(answer.interactionId), pending);
    const answered = reloaded.recordAnswered(answer);
    assert.equal(answered?.state, "answered");

    nowMs += 10;
    assert.deepEqual(
      reloaded.recordAnswered({ ...answer, response: { kind: "rejected" } }),
      answered,
    );
    assert.deepEqual(reloaded.cancel(answer.interactionId), answered);
    assert.deepEqual(reloaded.get(answer.interactionId), answered);
  } finally {
    await store.flush();
    await reloaded?.flush();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("terminal response windows cannot be revived or extended by late answers or cancellation", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
  let nowMs = Date.parse("2026-10-24T12:00:00.000Z");
  const store = await WorkResponseStore.open({
    stateDir,
    maxEntries: 8,
    pendingTtlMs: 1_000,
    retentionMs: 2_000,
    timeSource: () => nowMs,
  });
  const answer: AttentionResponse = {
    taskId: "task:expired",
    interactionId: "interaction:expired",
    response: { kind: "approved" },
  };

  try {
    store.registerPending(answer.taskId, answer.interactionId);
    store.registerPending(answer.taskId, "interaction:cancelled");
    store.cancel("interaction:cancelled");
    nowMs += 1_000;
    const expired = store.get(answer.interactionId);
    assert.equal(expired?.state, "expired");
    assert.deepEqual(store.get(answer.interactionId), expired);
    assert.deepEqual(store.cancel(answer.interactionId), expired);

    nowMs += 10;
    assert.deepEqual(store.recordAnswered(answer), expired);
    nowMs += 990;
    assert.equal(store.cancel("interaction:cancelled"), null);
    nowMs += 1_000;
    assert.equal(store.recordAnswered(answer), null);
    assert.equal(store.get(answer.interactionId), null);
  } finally {
    await store.flush();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("accepted core responses are recorded before pruning still-pending records", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
  let nowMs = Date.parse("2026-10-24T12:00:00.000Z");
  const store = await WorkResponseStore.open({
    stateDir,
    maxEntries: 1,
    pendingTtlMs: 100,
    retentionMs: 1_000,
    timeSource: () => nowMs,
  });
  try {
    store.registerPending("task", "interaction");
    assert.equal(store.reservePending(["new-interaction"]), false);
    assert.throws(() => store.registerPending("new-task", "new-interaction"), /capacity/);
    assert.equal(store.get("interaction")?.state, "pending");
    nowMs += 101;
    assert.equal(
      store.recordAnswered({
        taskId: "task",
        interactionId: "interaction",
        response: { kind: "approved" },
      })?.state,
      "answered",
    );
    assert.equal(store.reservePending(["new-interaction"]), true);
    assert.equal(store.get("interaction"), null);
    assert.equal(store.registerPending("new-task", "new-interaction").state, "pending");
  } finally {
    await store.flush();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("expiry withdraws once, persists pruning, and honors the earlier core deadline", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
  let nowMs = Date.parse("2026-10-24T12:00:00.000Z");
  const withdrawn: string[] = [];
  const options = {
    stateDir,
    maxEntries: 8,
    pendingTtlMs: 1_000,
    retentionMs: 2_000,
    timeSource: () => nowMs,
    onExpire: (taskId: string, interactionId: string) => {
      withdrawn.push(`${taskId}/${interactionId}`);
    },
  };
  const store = await WorkResponseStore.open(options);
  try {
    store.registerPending("task", "interaction");
    const deadline = new Date(nowMs + 100).toISOString();
    store.limitExpiry("wrong-task", "interaction", deadline);
    const unchanged = store.get("interaction");
    assert.ok(unchanged && "expiresAt" in unchanged);
    assert.notEqual(unchanged.expiresAt, deadline);
    store.limitExpiry("task", "interaction", deadline);
    store.limitExpiry("task", "interaction", new Date(nowMs + 500).toISOString());
    const limited = store.get("interaction");
    assert.ok(limited && "expiresAt" in limited);
    assert.equal(limited.expiresAt, deadline);
    nowMs += 100;
    const expired = store.get("interaction");
    assert.equal(expired?.state, "expired");
    assert.deepEqual(withdrawn, ["task/interaction"]);
    assert.deepEqual(store.cancel("interaction"), expired);
    store.prune();
    assert.deepEqual(withdrawn, ["task/interaction"]);
    await store.flush();
    const reloaded = await WorkResponseStore.open(options);
    assert.deepEqual(reloaded.get("interaction"), expired);
    assert.deepEqual(withdrawn, ["task/interaction"]);
    reloaded.registerPending("task", "interaction");
    assert.equal(reloaded.get("interaction")?.state, "pending");
    await reloaded.flush();
  } finally {
    await store.flush();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("work response store surfaces persistence failures and recovers on the next successful write", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
  const storePath = join(stateDir, "work-responses.json");
  const response: AttentionResponse = {
    taskId: "task:deploy-42",
    interactionId: "interaction:deploy-42:approval",
    response: { kind: "approved" },
  };

  try {
    const store = await WorkResponseStore.open({
      stateDir,
      maxEntries: 8,
      pendingTtlMs: 1_000,
      retentionMs: 1_000,
    });

    await rm(storePath, { force: true });
    await mkdir(storePath);

    store.registerPending("task:deploy-42", "interaction:deploy-42:approval");
    await assert.rejects(() => store.flush());

    await rm(storePath, { recursive: true, force: true });
    store.recordAnswered(response);
    await store.flush();

    const reloaded = await WorkResponseStore.open({
      stateDir,
      maxEntries: 8,
      pendingTtlMs: 1_000,
      retentionMs: 1_000,
    });

    assert.equal(reloaded.get("interaction:deploy-42:approval")?.state, "answered");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
