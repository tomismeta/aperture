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
