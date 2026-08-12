import assert from "node:assert/strict";

import type { SourceEvent } from "@tomismeta/aperture-core";
import {
  TRUNCATED_SOURCE_EVIDENCE_FACTOR,
  interpretSourceEvent,
  normalizeSourceEvent,
  semanticHintsForTruncatedSourceEvidence,
} from "@tomismeta/aperture-core/semantic";

const sourceEvent: SourceEvent = {
  id: "src:approval",
  taskId: "task:deploy",
  timestamp: "2026-03-21T18:00:00.000Z",
  type: "human.input.requested",
  interactionId: "interaction:deploy:approval",
  title: "Approve production deploy",
  summary: "The deploy will touch production systems and needs review.",
  request: { kind: "approval" },
};

const interpretation = interpretSourceEvent(sourceEvent);
assert.equal(interpretation.intentFrame, "approval_request");
assert.ok(["low", "medium", "high"].includes(interpretation.confidence));

const normalized = normalizeSourceEvent(sourceEvent);
assert.equal(normalized.type, "human.input.requested");
assert.equal(normalized.interactionId, sourceEvent.interactionId);
assert.equal(normalized.semantic?.intentFrame, "approval_request");

const clippedFailureHints = semanticHintsForTruncatedSourceEvidence({ status: "failed" });
assert.equal(clippedFailureHints.confidence, "low");
assert.deepEqual(clippedFailureHints.reasons, ["source failure evidence was truncated before Aperture saw the full output"]);
assert.deepEqual(clippedFailureHints.factors, [TRUNCATED_SOURCE_EVIDENCE_FACTOR]);

console.log("semantic entrypoint example passed");
