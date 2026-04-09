import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApertureRuntime } from "../src/runtime.js";
import {
  mapWorkEventToSourceEvent,
  normalizeWorkPayload,
  type WorkEvent,
} from "../src/work-event-ingest.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const EXAMPLE_DIR = resolve(REPO_ROOT, "schemas/examples/work-event");

const EXAMPLE_EXPECTATIONS: Record<string, { type: string; title?: string; summary?: string }> = {
  "coding-agent-status-waiting.json": {
    type: "task.updated",
    title: "Deploy service",
  },
  "coding-agent-approval-request.json": {
    type: "human.input.requested",
    title: "Approve production deploy",
  },
  "remote-review-choice-request.json": {
    type: "human.input.requested",
    title: "Select rollout plan",
  },
  "subagent-failure-update.json": {
    type: "task.updated",
    title: "Stabilize integration tests",
  },
  "workflow-completed.json": {
    type: "task.completed",
    summary: "Maintenance tasks completed successfully.",
  },
};

test("canonical work-event examples normalize and map into SourceEvent", () => {
  for (const filename of exampleFiles()) {
    const expectation = EXAMPLE_EXPECTATIONS[filename];
    assert.ok(expectation, `missing expectation for ${filename}`);

    const payload = readExample(filename);
    const eventPayload = normalizeWorkPayload(payload);
    assert.equal(typeof eventPayload, "object", `expected structured work event for ${filename}`);
    assert.equal(Array.isArray(eventPayload), false, `expected one normalized event for ${filename}`);

    const event = mapWorkEventToSourceEvent(eventPayload as WorkEvent);
    assert.equal(event.type, expectation.type, filename);
    if (expectation.title !== undefined) {
      assert.equal("title" in event ? event.title : undefined, expectation.title, filename);
    }
    if (expectation.summary !== undefined) {
      assert.equal("summary" in event ? event.summary : undefined, expectation.summary, filename);
    }
  }
});

test("canonical work-event examples are accepted by the primary runtime endpoint", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { baseUrl } = await runtime.listen();

  try {
    for (const filename of exampleFiles()) {
      const response = await fetch(`${baseUrl}/work`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readExample(filename)),
      });
      assert.equal(response.status, 200, `${filename} via /work`);
    }
  } finally {
    await runtime.close();
  }
});

function exampleFiles(): string[] {
  return readdirSync(EXAMPLE_DIR)
    .filter((entry) => entry.endsWith(".json"))
    .sort();
}

function readExample(filename: string): WorkEvent {
  return JSON.parse(readFileSync(resolve(EXAMPLE_DIR, filename), "utf8")) as WorkEvent;
}
