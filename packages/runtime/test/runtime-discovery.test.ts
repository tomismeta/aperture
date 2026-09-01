import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverLocalRuntimes, writeLocalRuntimeRegistration } from "../src/runtime-discovery.js";

test("runtime discovery ignores parseable registrations with invalid shapes", async () => {
  const registryDir = await mkdtemp(join(tmpdir(), "aperture-runtime-discovery-"));
  const now = new Date().toISOString();
  try {
    await writeLocalRuntimeRegistration(
      {
        id: "runtime-valid",
        kind: "aperture",
        controlUrl: "http://127.0.0.1:4546/runtime",
        tokenPath: join(registryDir, "token"),
        pid: process.pid,
        startedAt: now,
        updatedAt: now,
      },
      { registryDir },
    );
    await writeFile(
      join(registryDir, "invalid.json"),
      `${JSON.stringify({ kind: "aperture", updatedAt: now })}\n`,
      "utf8",
    );

    const registrations = await discoverLocalRuntimes({
      kind: "aperture",
      maxStalenessMs: 60_000,
      registryDir,
    });
    assert.deepEqual(
      registrations.map((registration) => registration.id),
      ["runtime-valid"],
    );
  } finally {
    await rm(registryDir, { recursive: true, force: true });
  }
});
