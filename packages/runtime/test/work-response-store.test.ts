import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AttentionResponse } from "@tomismeta/aperture-core";

import { WorkResponseStore } from "../src/work-response-store.js";

test("work response store tolerates invalid persisted JSON and starts empty", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-work-response-store-"));
  const storePath = join(stateDir, "work-responses.json");

  try {
    await writeFile(storePath, "{ definitely not valid json\n", "utf8");
    const store = await WorkResponseStore.open({
      stateDir,
      maxEntries: 8,
      pendingTtlMs: 1_000,
      retentionMs: 1_000,
    });

    assert.deepEqual(store.list(), []);
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
