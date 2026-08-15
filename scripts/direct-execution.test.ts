import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { isDirectExecution } from "./direct-execution.ts";

test("direct execution recognizes relative and absolute argv entries", () => {
  const modulePath = "/repo/scripts/check.ts";
  const moduleUrl = pathToFileURL(modulePath).href;

  assert.equal(isDirectExecution(moduleUrl, "scripts/check.ts", "/repo"), true);
  assert.equal(isDirectExecution(moduleUrl, modulePath, "/elsewhere"), true);
  assert.equal(isDirectExecution(moduleUrl, "scripts/other.ts", "/repo"), false);
  assert.equal(isDirectExecution(moduleUrl, undefined, "/repo"), false);
});
