import assert from "node:assert/strict";
import test from "node:test";

import { parseGitStatusFiles } from "../src/index.js";

test("parseGitStatusFiles preserves the first character of modified paths", () => {
  assert.deepEqual(
    parseGitStatusFiles(" M packages/core/src/semantic-detection.ts\n"),
    ["packages/core/src/semantic-detection.ts"],
  );

  assert.deepEqual(
    parseGitStatusFiles("M packages/core/src/semantic-detection.ts\n"),
    ["packages/core/src/semantic-detection.ts"],
  );
});

test("parseGitStatusFiles keeps rename destinations and untracked files", () => {
  assert.deepEqual(
    parseGitStatusFiles("R  old.ts -> packages/core/src/semantic-interpreter.ts\n?? packages/lab/test/example.ts\n"),
    [
      "packages/core/src/semantic-interpreter.ts",
      "packages/lab/test/example.ts",
    ],
  );
});
