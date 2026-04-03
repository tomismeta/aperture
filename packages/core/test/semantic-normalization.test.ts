import test from "node:test";
import assert from "node:assert/strict";

import {
  ApertureCore,
  type SourceEvent,
  type SourceRef,
} from "../src/index.js";
import { normalizeSemanticText } from "../src/semantic-detection.js";
import { interpretSourceEvent } from "../src/semantic-interpreter.js";
import { normalizeSourceEvent } from "../src/semantic-normalizer.js";

const timestamp = "2026-03-10T12:00:00.000Z";

function source(id: string): SourceRef {
  return { id };
}

test("normalizes high-risk human input into critical approval semantics", () => {
  const event: SourceEvent = {
    id: "evt:approval",
    type: "human.input.requested",
    taskId: "task:1",
    interactionId: "interaction:1",
    timestamp,
    source: source("claude-code"),
    title: "Approve Bash command",
    summary: "git push --force origin main",
    request: { kind: "approval" },
    riskHint: "high",
  };

  const normalized = normalizeSourceEvent(event);
  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type === "human.input.requested") {
    assert.equal(normalized.tone, "critical");
    assert.equal(normalized.consequence, "high");
  }
});

test("normalizes medium-risk human input into focused approval semantics", () => {
  const event: SourceEvent = {
    id: "evt:approval",
    type: "human.input.requested",
    taskId: "task:1",
    interactionId: "interaction:1",
    timestamp,
    source: source("codex"),
    title: "Approve command",
    summary: "git push origin main",
    request: { kind: "approval" },
    riskHint: "medium",
  };

  const normalized = normalizeSourceEvent(event);
  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type === "human.input.requested") {
    assert.equal(normalized.tone, "focused");
    assert.equal(normalized.consequence, "medium");
  }
});

test("normalizes low-risk human input into focused low-consequence approval semantics", () => {
  const event: SourceEvent = {
    id: "evt:approval",
    type: "human.input.requested",
    taskId: "task:1",
    interactionId: "interaction:1",
    timestamp,
    source: source("claude-code"),
    title: "Approve read",
    summary: "Read src/index.ts",
    request: { kind: "approval" },
    riskHint: "low",
  };

  const normalized = normalizeSourceEvent(event);
  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type === "human.input.requested") {
    assert.equal(normalized.tone, "focused");
    assert.equal(normalized.consequence, "low");
  }
});

test("uses medium consequence by default when no risk hint is provided", () => {
  const event: SourceEvent = {
    id: "evt:choice",
    type: "human.input.requested",
    taskId: "task:1",
    interactionId: "interaction:1",
    timestamp,
    source: source("custom-agent"),
    title: "Choose environment",
    summary: "Select a deployment target",
    request: {
      kind: "choice",
      options: [
        { id: "prod", label: "Production" },
        { id: "staging", label: "Staging" },
      ],
    },
  };

  const normalized = normalizeSourceEvent(event);
  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type === "human.input.requested") {
    assert.equal(normalized.tone, "focused");
    assert.equal(normalized.consequence, "medium");
  }
});

test("semantic interpreter infers high-risk approval semantics from dangerous text", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:danger",
    type: "human.input.requested",
    taskId: "task:danger",
    interactionId: "interaction:danger",
    timestamp,
    source: source("custom-agent"),
    title: "Approve production cleanup",
    summary: "Run rm -rf on production cache before deploy",
    request: { kind: "approval" },
  });

  assert.equal(interpretation.intentFrame, "approval_request");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.whyNow, "A high-risk action needs explicit operator approval.");
});

test("explicit semantic hints override inferred semantics", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:hinted",
    type: "human.input.requested",
    taskId: "task:hinted",
    interactionId: "interaction:hinted",
    timestamp,
    source: source("custom-agent"),
    title: "Approve read",
    summary: "Read a file in the repo",
    request: { kind: "approval" },
    semanticHints: {
      consequence: "high",
      whyNow: "A policy escalation requires senior review.",
      reasons: ["adapter provided a trusted escalation hint"],
    },
  });

  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.whyNow, "A policy escalation requires senior review.");
  assert.ok(interpretation.reasons.includes("adapter provided a trusted escalation hint"));
  assert.equal(interpretation.provenance?.consequence, "hint");
  assert.equal(interpretation.provenance?.whyNow, "hint");
});

test("task lifecycle semantics mark inferred provenance consistently", () => {
  const started = interpretSourceEvent({
    id: "evt:started",
    type: "task.started",
    taskId: "task:started",
    timestamp,
    source: source("custom-agent"),
    title: "Task started",
  });
  const completed = interpretSourceEvent({
    id: "evt:completed",
    type: "task.completed",
    taskId: "task:completed",
    timestamp,
    source: source("custom-agent"),
    title: "Task completed",
  });
  const cancelled = interpretSourceEvent({
    id: "evt:cancelled",
    type: "task.cancelled",
    taskId: "task:cancelled",
    timestamp,
    source: source("custom-agent"),
    title: "Task cancelled",
    reason: "operator aborted the run",
  });

  assert.deepEqual(started.provenance, {
    intentFrame: "inferred",
    activityClass: "inferred",
    consequence: "inferred",
    confidence: "inferred",
  });
  assert.deepEqual(completed.provenance, {
    intentFrame: "inferred",
    activityClass: "inferred",
    consequence: "inferred",
    confidence: "inferred",
  });
  assert.deepEqual(cancelled.provenance, {
    intentFrame: "inferred",
    activityClass: "inferred",
    consequence: "inferred",
    whyNow: "inferred",
    confidence: "inferred",
  });
});

test("risk-hinted human input keeps source provenance on consequence and confidence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:risk-hinted",
    type: "human.input.requested",
    taskId: "task:risk-hinted",
    interactionId: "interaction:risk-hinted",
    timestamp,
    source: source("custom-agent"),
    title: "Approve release deploy",
    summary: "Ship build 42 to production.",
    request: { kind: "approval" },
    toolFamily: "deploy",
    riskHint: "high",
  });

  assert.equal(interpretation.provenance?.intentFrame, "inferred");
  assert.equal(interpretation.provenance?.activityClass, "inferred");
  assert.equal(interpretation.provenance?.toolFamily, "source");
  assert.equal(interpretation.provenance?.consequence, "source");
  assert.equal(interpretation.provenance?.confidence, "source");
  assert.equal(interpretation.provenance?.whyNow, "inferred");
});

test("normalizes task status updates with semantic enrichment instead of raw passthrough", () => {
  const event: SourceEvent = {
    id: "evt:failed",
    type: "task.updated",
    taskId: "task:run:1",
    timestamp,
    source: source("custom-agent"),
    title: "Run failed",
    summary: "Migration failed in staging",
    status: "failed",
    progress: 82,
  };

  const normalized = normalizeSourceEvent(event);
  assert.equal(normalized.type, event.type);
  if (normalized.type === "task.updated") {
    assert.equal(normalized.activityClass, "tool_failure");
    assert.equal(normalized.semantic?.intentFrame, "failure");
    assert.equal(normalized.semantic?.consequence, "high");
    assert.equal(normalized.semantic?.whyNow, "Work has failed and should be reviewed.");
  }
});

test("failed edit readback observations stay status updates semantically", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:edit-readback",
    type: "task.updated",
    taskId: "task:edit-readback",
    timestamp,
    source: source("custom-agent"),
    title: "edit failure",
    summary: "OBSERVATION: Here's the result of running `cat -n` on /testbed/djmoney/models/fields.py: 1 from decimal import Decimal",
    status: "failed",
    toolFamily: "edit",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.whyNow, undefined);
});

test("failed read source dumps stay status updates at high consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-content-observation",
    type: "task.updated",
    taskId: "task:read-content-observation",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary: "<path>/repo/src/kernel/process.c</path> <type>file</type> <content>1622: static struct process *create_process(void) 1623: { 1624: return 0; }",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
});

test("failed read log dumps stay status updates at low consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-log-observation",
    type: "task.updated",
    taskId: "task:read-log-observation",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary: "<path>/tmp/tool-output/kernel.log</path> <type>file</type> <content>1190: [ 4.998830] amdgpu ring comp_1.2.1 uses VM inv eng 10 on hub 0",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
});

test("failed read build metadata dumps stay status updates at low consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-build-metadata",
    type: "task.updated",
    taskId: "task:read-build-metadata",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary: "<path>/repo/Makefile</path> <type>file</type> <content>1: SPDX-License-Identifier: GPL-2.0 2: VERSION = 6 3: PATCHLEVEL = 16 4: SUBLEVEL = 0 5: EXTRAVERSION =</content>",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
});

test("failed search result dumps stay low-consequence failures", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:search-result-dump",
    type: "task.updated",
    taskId: "task:search-result-dump",
    timestamp,
    source: source("custom-agent"),
    title: "search failure",
    summary: "OBSERVATION: Found 12 matches in 3 files. Showing first 10 results from /repo/src/app.ts and /repo/src/lib.ts",
    status: "failed",
    toolFamily: "search",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "low");
});

test("plain failed reads without observational payload stay failures", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:plain-read-failure",
    type: "task.updated",
    taskId: "task:plain-read-failure",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary: "Failed to read /repo/src/config.ts because the file does not exist",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
});

test("public trajectory diagnostic failures stay medium-consequence failures", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-diagnostic",
    type: "task.updated",
    taskId: "task:public-diagnostic",
    timestamp,
    source: { id: "swe-smith", kind: "public-trajectory" },
    title: "bash failure",
    summary: "OBSERVATION: Form is valid: False. Form errors: amount required. Decompress result: [None, 'USD']",
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "medium");
});

test("public trajectory silent cleanup observations stay low-consequence status updates", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-cleanup",
    type: "task.updated",
    taskId: "task:public-cleanup",
    timestamp,
    source: { id: "swe-smith", kind: "public-trajectory" },
    title: "bash observation",
    summary: "Your command ran successfully and did not produce any output.",
    status: "running",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
});

test("task updates can infer implied operator asks from status text", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:blocked",
    type: "task.updated",
    taskId: "task:blocked",
    timestamp,
    source: source("custom-agent"),
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue",
    status: "waiting",
  });

  assert.equal(normalized.type, "task.updated");
  if (normalized.type === "task.updated") {
    assert.equal(normalized.semantic?.whyNow, "Status text implies the operator may need to respond.");
    assert.equal(normalized.semantic?.confidence, "low");
    assert.ok(normalized.semantic?.reasons.includes("status wording suggests an implied operator request"));
  }
});

test("negated approval wording does not invent an implied operator ask", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:no-approval-needed",
    type: "task.updated",
    taskId: "task:no-approval-needed",
    timestamp,
    source: source("custom-agent"),
    title: "Continuing automatically",
    summary: "No approval needed, continuing automatically.",
    status: "running",
  });

  assert.equal(interpretation.whyNow, undefined);
  assert.equal(interpretation.confidence, "high");
});

test("semantic normalization preserves path and hyphen separators", () => {
  assert.equal(
    normalizeSemanticText("Inspect /workspace/foo-bar.ts before continuing."),
    "inspect /workspace/foo-bar.ts before continuing.",
  );
});

test("task updates can infer relation hints from recurring and resolving language", () => {
  const repeated = interpretSourceEvent({
    id: "evt:repeat",
    type: "task.updated",
    taskId: "task:repeat",
    timestamp,
    source: source("custom-agent"),
    title: "Build failed again",
    summary: "The same build is still failing in production",
    status: "failed",
  });

  const resolved = interpretSourceEvent({
    id: "evt:resolved",
    type: "task.updated",
    taskId: "task:repeat",
    timestamp,
    source: source("custom-agent"),
    title: "Build issue resolved",
    summary: "The deploy is fixed and no longer blocked",
    status: "completed",
  });

  assert.deepEqual(repeated.relationHints.map((hint) => hint.kind), ["same_issue", "repeats"]);
  assert.deepEqual(resolved.relationHints.map((hint) => hint.kind), ["same_issue", "resolves"]);
});

test("repeat wording without an issue signal does not infer relation hints", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:repeat-no-issue",
    type: "task.updated",
    taskId: "task:repeat-no-issue",
    timestamp,
    source: source("custom-agent"),
    title: "Still running",
    summary: "The task remains active and is continuing normally.",
    status: "running",
  });

  assert.deepEqual(interpretation.relationHints, []);
});

test("passive dramatic status does not infer repeat relations from wording alone", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:dramatic-passive",
    type: "task.updated",
    taskId: "task:dramatic-passive",
    timestamp,
    source: source("custom-agent"),
    title: "Critical path still running",
    summary: "Critical path still running, no action needed.",
    status: "running",
  });

  assert.deepEqual(interpretation.relationHints, []);
});

test("read-oriented approvals mentioning production stay low consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:prod-read",
    type: "human.input.requested",
    taskId: "task:prod-read",
    interactionId: "interaction:prod-read",
    timestamp,
    source: source("custom-agent"),
    title: "Approve production runbook read",
    summary: "Read the production deploy runbook before answering.",
    request: { kind: "approval" },
    toolFamily: "read",
  });

  assert.equal(interpretation.toolFamily, "read");
  assert.equal(interpretation.consequence, "low");
  assert.equal(interpretation.confidence, "medium");
});

test("routine successful bash observations without output stay low consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:bash-success-no-output",
    type: "task.updated",
    taskId: "task:bash-success-no-output",
    timestamp,
    source: source("custom-agent"),
    title: "bash observation",
    summary: "Your command ran successfully and did not produce any output.",
    status: "running",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.consequence, "low");
});

test("expected diagnostic bash failures stay medium consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:bash-diagnostic-failure",
    type: "task.updated",
    taskId: "task:bash-diagnostic-failure",
    timestamp,
    source: source("custom-agent"),
    title: "bash failure",
    summary: "OBSERVATION: Form is valid: False Form errors: <ul class=\"errorlist\"><li>This field is required.</li></ul> Decompress result: [None, 'USD']",
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.consequence, "medium");
});

test("produce wording does not trigger production risk escalation", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:produce-report",
    type: "human.input.requested",
    taskId: "task:produce-report",
    interactionId: "interaction:produce-report",
    timestamp,
    source: source("custom-agent"),
    title: "Approve local report generation",
    summary: "Run the script to produce a report file locally.",
    request: { kind: "approval" },
    toolFamily: "bash",
  });

  assert.equal(interpretation.consequence, "medium");
});

test("choice requests do not infer tool family from question wording alone", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:question-read-wording",
    type: "human.input.requested",
    taskId: "task:question-read-wording",
    interactionId: "interaction:question-read-wording",
    timestamp,
    source: source("custom-agent"),
    title: "Should we read the config first?",
    summary: "Choose the next step.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    },
  });

  assert.equal(interpretation.toolFamily, undefined);
  assert.equal(interpretation.confidence, "low");

  const normalized = normalizeSourceEvent({
    id: "evt:question-read-wording",
    type: "human.input.requested",
    taskId: "task:question-read-wording",
    interactionId: "interaction:question-read-wording",
    timestamp,
    source: source("custom-agent"),
    title: "Should we read the config first?",
    summary: "Choose the next step.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    },
  });

  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type === "human.input.requested") {
    assert.equal(normalized.toolFamily, undefined);
  }
});

test("choice requests still preserve explicit tool family from context", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:question-explicit-tool-family",
    type: "human.input.requested",
    taskId: "task:question-explicit-tool-family",
    interactionId: "interaction:question-explicit-tool-family",
    timestamp,
    source: source("custom-agent"),
    title: "Should we read the config first?",
    summary: "Choose the next step.",
    context: {
      items: [
        { id: "toolFamily", label: "Tool Family", value: "read" },
      ],
    },
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    },
  });

  assert.equal(interpretation.toolFamily, "read");
  assert.equal(interpretation.confidence, "low");
  assert.ok(interpretation.reasons.includes("tool family was supplied by the source or context"));
  assert.equal(interpretation.provenance?.toolFamily, "source");

  const normalized = normalizeSourceEvent({
    id: "evt:question-explicit-tool-family",
    type: "human.input.requested",
    taskId: "task:question-explicit-tool-family",
    interactionId: "interaction:question-explicit-tool-family",
    timestamp,
    source: source("custom-agent"),
    title: "Should we read the config first?",
    summary: "Choose the next step.",
    context: {
      items: [
        { id: "toolFamily", label: "Tool Family", value: "read" },
      ],
    },
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    },
  });

  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type === "human.input.requested") {
    assert.equal(normalized.toolFamily, undefined);
    assert.equal(normalized.semantic?.toolFamily, "read");
    assert.equal(normalized.semantic?.provenance?.toolFamily, "source");
  }
});

test("equivalent source approvals normalize to equivalent semantics across sources", () => {
  const sources = [source("claude-code"), source("codex"), source("opencode")];

  const normalized = sources.map((src, index) =>
    normalizeSourceEvent({
      id: `evt:${index}`,
      type: "human.input.requested",
      taskId: `task:${index}`,
      interactionId: `interaction:${index}`,
      timestamp,
      source: src,
      title: "Approve operation",
      summary: "The source requested approval.",
      request: { kind: "approval" },
      riskHint: "high",
    }),
  );

  for (const event of normalized) {
    assert.equal(event.type, "human.input.requested");
    if (event.type === "human.input.requested") {
      assert.equal(event.tone, "critical");
      assert.equal(event.consequence, "high");
      assert.equal(event.request.kind, "approval");
    }
  }
});

test("publishSourceEvent feeds normalized events into the existing attention engine", () => {
  const core = new ApertureCore();

  core.publishSourceEvent({
    id: "evt:approval",
    type: "human.input.requested",
    taskId: "task:deploy",
    interactionId: "interaction:deploy",
    timestamp,
    source: source("claude-code"),
    title: "Approve deploy",
    summary: "A risky deploy is waiting.",
    request: { kind: "approval" },
    riskHint: "high",
  });

  const frame = core.getFrame("task:deploy");
  assert.ok(frame);
  assert.equal(frame?.mode, "approval");
  assert.equal(frame?.tone, "critical");
  assert.equal(frame?.consequence, "high");
  assert.equal(frame?.responseSpec.kind, "approval");
});

test("publishSourceEvent can use the semantic layer to elevate dangerous approvals without an explicit risk hint", () => {
  const core = new ApertureCore();

  core.publishSourceEvent({
    id: "evt:destructive",
    type: "human.input.requested",
    taskId: "task:cleanup",
    interactionId: "interaction:cleanup",
    timestamp,
    source: source("claude-code"),
    title: "Approve production cleanup",
    summary: "Run rm -rf on production cache before deploy",
    request: { kind: "approval" },
  });

  const frame = core.getFrame("task:cleanup");
  assert.ok(frame);
  assert.equal(frame?.mode, "approval");
  assert.equal(frame?.tone, "critical");
  assert.equal(frame?.consequence, "high");
});

test("publishSourceEvent matches publishing the equivalent normalized human-input event", () => {
  const sourceEvent: SourceEvent = {
    id: "evt:parity:approval",
    type: "human.input.requested",
    taskId: "task:parity:approval",
    interactionId: "interaction:parity:approval",
    timestamp,
    source: source("claude-code"),
    title: "Approve deploy",
    summary: "A risky deploy is waiting for approval.",
    request: { kind: "approval", requireReason: true },
    provenance: {
      whyNow: "Adapter already knows this is a release checkpoint.",
      factors: ["adapter release gate"],
    },
  };
  const normalizedEvent = normalizeSourceEvent(sourceEvent);
  const sourceCore = new ApertureCore();
  const eventCore = new ApertureCore();

  sourceCore.publishSourceEvent(sourceEvent);
  eventCore.publish(normalizedEvent);

  assert.deepEqual(sourceCore.getAttentionView(), eventCore.getAttentionView());
});

test("publishSourceEvent matches publishing the equivalent normalized status event", () => {
  const sourceEvent: SourceEvent = {
    id: "evt:parity:status",
    type: "task.updated",
    taskId: "task:parity:status",
    timestamp,
    source: source("custom-agent"),
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
    progress: 80,
  };
  const normalizedEvent = normalizeSourceEvent(sourceEvent);
  const sourceCore = new ApertureCore();
  const eventCore = new ApertureCore();

  sourceCore.publishSourceEvent(sourceEvent);
  eventCore.publish(normalizedEvent);

  assert.deepEqual(sourceCore.getTaskView(sourceEvent.taskId), eventCore.getTaskView(sourceEvent.taskId));
  assert.deepEqual(sourceCore.getAttentionView(), eventCore.getAttentionView());
});

test("publishSourceEvent matches publishing the equivalent low-confidence normalized status event", () => {
  const sourceEvent: SourceEvent = {
    id: "evt:parity:status:low-confidence",
    type: "task.updated",
    taskId: "task:parity:status:low-confidence",
    timestamp,
    source: source("custom-agent"),
    title: "Build failed",
    summary: "The latest build failed and may need a retry.",
    status: "failed",
    semanticHints: {
      confidence: "low",
    },
  };
  const normalizedEvent = normalizeSourceEvent(sourceEvent);
  const sourceCore = new ApertureCore();
  const eventCore = new ApertureCore();

  sourceCore.publishSourceEvent(sourceEvent);
  eventCore.publish(normalizedEvent);

  assert.deepEqual(sourceCore.getTaskView(sourceEvent.taskId), eventCore.getTaskView(sourceEvent.taskId));
  assert.deepEqual(sourceCore.getAttentionView(), eventCore.getAttentionView());
});

test("publishSourceEvent matches publishing the equivalent abstained normalized status event", () => {
  const sourceEvent: SourceEvent = {
    id: "evt:parity:status:abstained",
    type: "task.updated",
    taskId: "task:parity:status:abstained",
    timestamp,
    source: source("custom-agent"),
    title: "Dependency fetch blocked",
    summary: "Dependency fetch is blocked, but the semantic read abstains until clearer evidence arrives.",
    status: "blocked",
    semanticHints: {
      abstained: true,
    },
  };
  const normalizedEvent = normalizeSourceEvent(sourceEvent);
  const sourceCore = new ApertureCore();
  const eventCore = new ApertureCore();

  sourceCore.publishSourceEvent(sourceEvent);
  eventCore.publish(normalizedEvent);

  assert.deepEqual(sourceCore.getTaskView(sourceEvent.taskId), eventCore.getTaskView(sourceEvent.taskId));
  assert.deepEqual(sourceCore.getAttentionView(), eventCore.getAttentionView());
});
