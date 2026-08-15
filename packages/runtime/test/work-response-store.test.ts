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
