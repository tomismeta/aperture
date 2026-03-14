import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApertureCore } from "@tomismeta/aperture-core";

const timestamp = "2026-03-13T18:00:00.000Z";
const stateDir = await mkdtemp(join(tmpdir(), "aperture-core-example-"));

try {
  const core = await ApertureCore.fromMarkdown(stateDir);

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

  const snapshot = await core.checkpointMemory("2026-03-13T18:05:00.000Z");
  assert.ok(snapshot);
  assert.equal(snapshot.sessionCount, 1);
  assert.equal(snapshot.toolFamilies?.read?.presentations, 1);
  assert.equal(snapshot.toolFamilies?.read?.responses, 1);

  const memory = await readFile(join(stateDir, "MEMORY.md"), "utf8");
  assert.match(memory, /## Tool Families/);
  assert.match(memory, /### read/);
  assert.match(memory, /- responses: 1/);

  console.log("full engine example passed");
} finally {
  await rm(stateDir, { recursive: true, force: true });
}
