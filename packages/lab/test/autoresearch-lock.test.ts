import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireAutoresearchProcessLock,
} from "../src/autoresearch-lock.js";

test("acquireAutoresearchProcessLock rejects a live duplicate lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-lock-"));
  const lockPath = path.join(directory, "current-service.lock.json");

  const release = await acquireAutoresearchProcessLock(lockPath, {
    kind: "service",
    id: "service-a",
    root: "/tmp/service-a",
    pid: process.pid,
    createdAt: "2026-03-30T00:00:00.000Z",
    sourceRepo: "/tmp/repo",
  });

  await assert.rejects(
    () => acquireAutoresearchProcessLock(lockPath, {
      kind: "service",
      id: "service-b",
      root: "/tmp/service-b",
      pid: process.pid,
      createdAt: "2026-03-30T00:00:01.000Z",
      sourceRepo: "/tmp/repo",
    }),
    /Another F-Stop service is already running/,
  );

  await release();
});

test("acquireAutoresearchProcessLock replaces stale lock files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-lock-stale-"));
  const lockPath = path.join(directory, "current-sweep.lock.json");

  await writeFile(lockPath, `${JSON.stringify({
    kind: "sweep",
    id: "old-sweep",
    root: "/tmp/old-sweep",
    pid: 999_999_999,
    createdAt: "2026-03-30T00:00:00.000Z",
    sourceRepo: "/tmp/repo",
  }, null, 2)}\n`, "utf8");

  const release = await acquireAutoresearchProcessLock(lockPath, {
    kind: "sweep",
    id: "new-sweep",
    root: "/tmp/new-sweep",
    pid: process.pid,
    createdAt: "2026-03-30T00:00:01.000Z",
    sourceRepo: "/tmp/repo",
  });

  const contents = JSON.parse(await readFile(lockPath, "utf8")) as { id: string };
  assert.equal(contents.id, "new-sweep");

  await release();
});
