import assert from "node:assert/strict";

import { interpretSourceEvent, normalizeSourceEvent } from "@tomismeta/aperture-core/semantic";

const sourceEvent = {
  id: "src:approval",
  taskId: "task:deploy",
  timestamp: "2026-03-21T18:00:00.000Z",
  type: "human.input.requested" as const,
  interactionId: "interaction:deploy:approval",
  title: "Approve production deploy",
  summary: "The deploy will touch production systems and needs review.",
  request: { kind: "approval" as const },
};

const interpretation = interpretSourceEvent(sourceEvent);
assert.equal(interpretation.intentFrame, "approval_request");
assert.ok(["low", "medium", "high"].includes(interpretation.confidence));

const normalized = normalizeSourceEvent(sourceEvent);
assert.equal(normalized.type, "human.input.requested");
assert.equal(normalized.interactionId, sourceEvent.interactionId);
assert.equal(normalized.semantic?.intentFrame, "approval_request");

console.log("semantic entrypoint example passed");
