import assert from "node:assert/strict";

import { ApertureCore } from "@tomismeta/aperture-core";

const timestamp = "2026-03-13T18:00:00.000Z";
const core = new ApertureCore();

const frame = core.publish({
  id: "evt:read",
  taskId: "task:docs-review",
  interactionId: "interaction:read:readme",
  timestamp,
  source: {
    id: "claude-session",
    kind: "claude-code",
    label: "Claude Code",
  },
  type: "human.input.requested",
  toolFamily: "read",
  title: "Read README.md",
  summary: "Claude Code wants to inspect the project README before editing docs.",
  consequence: "low",
  request: {
    kind: "approval",
  },
});

assert.ok(frame);
assert.equal(frame.mode, "approval");
assert.equal(core.getAttentionView().active?.interactionId, "interaction:read:readme");

core.submit({
  taskId: "task:docs-review",
  interactionId: "interaction:read:readme",
  response: { kind: "approved" },
});

assert.equal(core.getAttentionView().active, null);

console.log("full engine example passed");
