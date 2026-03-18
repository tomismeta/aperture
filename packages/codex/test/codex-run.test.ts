import test from "node:test";
import assert from "node:assert/strict";

import { buildCodexRunInput, parseCodexRunArgs } from "../src/run.js";

test("parseCodexRunArgs parses a new thread launch", () => {
  assert.deepEqual(
    parseCodexRunArgs([
      "--cwd",
      "/repo",
      "--model",
      "gpt-5.4",
      "--approval-policy",
      "on-request",
      "--sandbox",
      "workspace-write",
      "--effort",
      "high",
      "Fix",
      "the",
      "failing",
      "test",
    ]),
    {
      cwd: "/repo",
      model: "gpt-5.4",
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      effort: "high",
      prompt: "Fix the failing test",
    },
  );
});

test("parseCodexRunArgs parses a resumed thread launch", () => {
  assert.deepEqual(
    parseCodexRunArgs([
      "--thread",
      "thread-123",
      "--summary",
      "concise",
      "--personality",
      "pragmatic",
      "Explain",
      "the",
      "change",
    ]),
    {
      resumeThreadId: "thread-123",
      summary: "concise",
      personality: "pragmatic",
      prompt: "Explain the change",
    },
  );
});

test("parseCodexRunArgs requires a prompt", () => {
  assert.throws(
    () => parseCodexRunArgs(["--cwd", "/repo"]),
    /Provide a Codex prompt/,
  );
});

test("buildCodexRunInput wraps the prompt as a text item", () => {
  assert.deepEqual(buildCodexRunInput("Ship it"), [
    { type: "text", text: "Ship it", text_elements: [] },
  ]);
});

test("parseCodexRunArgs rejects unsupported summary values", () => {
  assert.throws(
    () => parseCodexRunArgs(["--summary", "verbose", "Ship", "it"]),
    /--summary/,
  );
});

test("parseCodexRunArgs rejects unsupported approval policies", () => {
  assert.throws(
    () => parseCodexRunArgs(["--approval-policy", "always", "Ship", "it"]),
    /--approval-policy/,
  );
});

test("parseCodexRunArgs rejects unsupported sandbox values", () => {
  assert.throws(
    () => parseCodexRunArgs(["--sandbox", "sandboxed", "Ship", "it"]),
    /--sandbox/,
  );
});
