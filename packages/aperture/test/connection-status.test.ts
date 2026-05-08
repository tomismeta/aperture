import assert from "node:assert/strict";
import test from "node:test";

import { LauncherConnectionStore, makeConnectionEntry } from "../src/connection-status.js";

test("LauncherConnectionStore offers show setup after integrations are ready", () => {
  const store = new LauncherConnectionStore([
    makeConnectionEntry(
      "claude",
      "Claude Code",
      "ready",
      "Attached to an existing Claude Code bridge.",
    ),
    makeConnectionEntry(
      "opencode",
      "OpenCode",
      "ready",
      "Connected OpenCode at http://127.0.0.1:4096 (1 profile).",
    ),
  ]);

  const snapshot = store.getSnapshot();

  assert.deepEqual(snapshot.actions, [{ id: "show-setup", key: "s", label: "show setup" }]);
});

test("LauncherConnectionStore keeps show setup after skip suppresses pending entries", () => {
  const store = new LauncherConnectionStore([
    makeConnectionEntry(
      "claude",
      "Claude Code",
      "action",
      "Claude bridge is ready. Claude Code still needs to reload the updated hooks.",
    ),
  ]);

  store.suppressPending();

  const snapshot = store.getSnapshot();

  assert.deepEqual(snapshot.actions, [{ id: "show-setup", key: "s", label: "show setup" }]);
});
