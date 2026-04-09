import test from "node:test";
import assert from "node:assert/strict";

import { TaskViewStore } from "../src/task-view-store.js";
import type { AttentionFrame } from "../src/frame.js";

function createFrame(index: number): AttentionFrame {
  return {
    id: `frame:${index}`,
    taskId: "task:ambient",
    interactionId: `interaction:${index}`,
    version: 1,
    mode: "status",
    tone: "ambient",
    consequence: "low",
    title: `Ambient ${index}`,
    responseSpec: { kind: "none" },
    timing: {
      createdAt: `2026-03-09T12:${String(index).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-03-09T12:${String(index).padStart(2, "0")}:00.000Z`,
    },
  };
}

test("task view store bounds ambient retention per task", () => {
  const store = new TaskViewStore();

  for (let index = 0; index < 20; index += 1) {
    store.addAmbient("task:ambient", createFrame(index));
  }

  const view = store.get("task:ambient");
  assert.equal(view.ambient.length, 12);
  assert.equal(view.ambient[0]?.interactionId, "interaction:19");
  assert.equal(view.ambient.at(-1)?.interactionId, "interaction:8");
});

test("task view store prunes empty task entries", () => {
  const store = new TaskViewStore();
  store.addAmbient("task:ambient", createFrame(1));

  const cleared = store.clear("task:ambient");
  assert.equal(cleared.ambient.length, 0);
  assert.equal(Array.from(store.values()).length, 0);
});
