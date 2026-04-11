import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  initializeRuntimeAuth,
  isAuthorizedRequest,
  readRuntimeAuthToken,
} from "../src/runtime-auth.js";

test("runtime auth accepts matching bearer tokens and rejects mismatches", () => {
  const token = "0123456789abcdef";

  assert.equal(isAuthorizedRequest(`Bearer ${token}`, token), true);
  assert.equal(isAuthorizedRequest(`Bearer ${token}x`, token), false);
  assert.equal(isAuthorizedRequest("Bearer", token), false);
  assert.equal(isAuthorizedRequest(undefined, token), false);
});

test("runtime auth token files are initialized and readable through the secure helper", async () => {
  const runtimeId = `test:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const auth = await initializeRuntimeAuth(runtimeId);

  try {
    const token = await readRuntimeAuthToken(auth.tokenPath);
    assert.equal(token, auth.token);
  } finally {
    await rm(auth.stateDir, { recursive: true, force: true });
  }
});

test("runtime auth rejects permissive token file modes on posix systems", async () => {
  if (process.platform === "win32") {
    return;
  }

  const stateDir = await mkdtemp(join(tmpdir(), "aperture-runtime-auth-"));
  const tokenPath = join(stateDir, "token");

  try {
    await writeFile(tokenPath, "secret-token\n", { encoding: "utf8", mode: 0o644 });
    await chmod(tokenPath, 0o644);
    await assert.rejects(
      () => readRuntimeAuthToken(tokenPath),
      /must not be group- or world-readable/i,
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
