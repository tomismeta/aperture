import test from "node:test";
import assert from "node:assert/strict";

import { ApertureCore, type SourceEvent, type SourceRef } from "../src/index.js";
import { semanticHintsForTruncatedSourceEvidence } from "../src/semantic.js";
import { normalizeSemanticText } from "../src/semantic-detection.js";
import { interpretSourceEvent } from "../src/semantic-interpreter.js";
import { normalizeSourceEvent } from "../src/semantic-normalizer.js";
import { readAttentionOntologyDiagnostic } from "../src/semantic-ontology.js";

const timestamp = "2026-03-10T12:00:00.000Z";
const rejectedToolUseMessage =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const successfulTestObservationTranscript =
  "OBSERVATION: === Testing quote formatting === All quote formatting tests passed!";
const abbreviatedFileViewObservationTranscript =
  "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE> 1 # fmt: off 2 from __future__ import an...";

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

test("normalizes completed task updates into completion activity without adapter hints", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:completed-update",
    type: "task.updated",
    taskId: "task:completed-update",
    timestamp,
    source: source("custom-agent"),
    title: "Command completed",
    summary: "The command finished successfully.",
    status: "completed",
    toolFamily: "bash",
  });

  assert.equal(normalized.type, "task.updated");
  if (normalized.type !== "task.updated") {
    throw new Error("Expected normalized task.updated event.");
  }

  assert.equal(normalized.activityClass, "tool_completion");
  assert.equal(normalized.semantic.intentFrame, "completion");
  assert.equal(normalized.semantic.activityClass, "tool_completion");
  assert.equal(normalized.semantic.toolFamily, "bash");
  assert.equal(normalized.semantic.provenance?.activityClass, "inferred");
});

test("normalizes completed task updates without overriding explicit source activity", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:completed-session-status",
    type: "task.updated",
    taskId: "task:completed-session-status",
    timestamp,
    source: source("custom-agent"),
    title: "Workspace ready",
    summary: "The workspace setup completed.",
    status: "completed",
    activityClass: "session_status",
  });

  assert.equal(normalized.type, "task.updated");
  if (normalized.type !== "task.updated") {
    throw new Error("Expected normalized task.updated event.");
  }

  assert.equal(normalized.activityClass, "session_status");
  assert.equal(normalized.semantic.intentFrame, "completion");
  assert.equal(normalized.semantic.activityClass, "session_status");
  assert.equal(normalized.semantic.provenance?.activityClass, "source");
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

test("semantic interpreter recognizes returned issue language as resurfacing the same issue", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:returned-issue",
    type: "task.updated",
    taskId: "task:returned-issue",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy issue returned",
    summary: "The production deploy issue has returned after recovery.",
    status: "failed",
  });

  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    ["same_issue", "repeats"],
  );
});

test("semantic interpreter recognizes regressed issue language as resurfacing escalation", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:regressed-issue",
    type: "task.updated",
    taskId: "task:regressed-issue",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy issue regressed after fix",
    summary: "The production deploy issue came back and regressed after the earlier recovery.",
    status: "failed",
  });

  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    ["same_issue", "repeats", "escalates"],
  );
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
    summary:
      "OBSERVATION: Here's the result of running `cat -n` on /testbed/djmoney/models/fields.py: 1 from decimal import Decimal",
    status: "failed",
    toolFamily: "edit",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
  assert.equal(
    interpretation.whyNow,
    "A failed status carried high-consequence observation output that should be reviewed.",
  );
});

test("failed edit outcome envelopes preserve applied versus failed semantics", () => {
  const applied = interpretSourceEvent({
    id: "evt:edit-applied-readback",
    type: "task.updated",
    taskId: "task:edit-applied-readback",
    timestamp,
    source: source("custom-agent"),
    title: "edit failure",
    summary:
      "Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\nexport const value = 1;",
    status: "failed",
    toolFamily: "edit",
  });
  const failed = interpretSourceEvent({
    id: "evt:edit-precondition-failure",
    type: "task.updated",
    taskId: "task:edit-precondition-failure",
    timestamp,
    source: source("custom-agent"),
    title: "edit failure",
    summary:
      "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>",
    status: "failed",
    toolFamily: "edit",
  });

  assert.equal(applied.intentFrame, "status_update");
  assert.equal(applied.activityClass, "status_update");
  assert.equal(applied.consequence, "high");
  assert.equal(failed.intentFrame, "failure");
  assert.equal(failed.activityClass, "tool_failure");
  assert.equal(failed.consequence, "high");
});

test("failed read source dumps stay status updates at high consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-content-observation",
    type: "task.updated",
    taskId: "task:read-content-observation",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      "<path>/repo/src/kernel/process.c</path> <type>file</type> <content>1622: static struct process *create_process(void) 1623: { 1624: return 0; }",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
  assert.equal(
    interpretation.whyNow,
    "A failed status carried high-consequence observation output that should be reviewed.",
  );
});

test("failed read log dumps stay status updates at low consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-log-observation",
    type: "task.updated",
    taskId: "task:read-log-observation",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      "<path>/tmp/tool-output/kernel.log</path> <type>file</type> <content>1190: [ 4.998830] amdgpu ring comp_1.2.1 uses VM inv eng 10 on hub 0",
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
    summary:
      "<path>/repo/Makefile</path> <type>file</type> <content>1: SPDX-License-Identifier: GPL-2.0 2: VERSION = 6 3: PATCHLEVEL = 16 4: SUBLEVEL = 0 5: EXTRAVERSION =</content>",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
});

test("failed search result dumps stay low-consequence status updates", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:search-result-dump",
    type: "task.updated",
    taskId: "task:search-result-dump",
    timestamp,
    source: source("custom-agent"),
    title: "search failure",
    summary:
      "OBSERVATION: Found 12 matches in 3 files. Showing first 10 results from /repo/src/app.ts and /repo/src/lib.ts",
    status: "failed",
    toolFamily: "search",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
});

test("failed grep context dumps stay low-consequence status updates", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:search-grep-context-dump",
    type: "task.updated",
    taskId: "task:search-grep-context-dump",
    timestamp,
    source: source("custom-agent"),
    title: "search failure",
    summary:
      "2255-- VOP3SD has an SDST field 2256- - V_ADD_CO_U32 adds with carry-out 2257- - V_DIV_SCALE_F32 uses the same encoding",
    status: "failed",
    toolFamily: "search",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
});

test("ordinary numbered search lists stay failure-shaped", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:search-numbered-list",
    type: "task.updated",
    taskId: "task:search-numbered-list",
    timestamp,
    source: source("custom-agent"),
    title: "search failure",
    summary: "1- first item 2- second item 3- third item",
    status: "failed",
    toolFamily: "search",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
});

test("failed arrow-numbered technical read fragments stay status updates", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-technical-doc-fragment",
    type: "task.updated",
    taskId: "task:read-technical-doc-fragment",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      "2783\u2192## 7.6. Dual Issue VALU 2784\u2192 2785\u2192The VOPD instruction encoding allows a single shader instruction to encode two separate VALU operations that are executed in parallel. The two operations must be independent of each other. This ins...",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
});

test("unclipped acronym-rich arrow read prose stays failure-shaped", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-acronym-prose",
    type: "task.updated",
    taskId: "task:read-acronym-prose",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      "101\u2192## 7.6. API SDK Notes 102\u2192 103\u2192The API and SDK entries are discussed here without an emitted read-window clipping boundary.",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
});

test("structured bash output without exit or source evidence stays failure-shaped", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:structured-output-unclassified",
    type: "task.updated",
    taskId: "task:structured-output-unclassified",
    timestamp,
    source: source("custom-agent"),
    title: "bash failure",
    summary: '{"wall_time":"0.0510 seconds","output":"Collected benchmark rows."}',
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
});

test("structured bash source output stays observational but high consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:structured-source-output-observation",
    type: "task.updated",
    taskId: "task:structured-source-output-observation",
    timestamp,
    source: source("custom-agent"),
    title: "bash failure",
    summary:
      '{"wall_time":"0.0510 seconds","output":"#include <stdexcept>\\nint main() { throw new Error(); return 0; }"}',
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
});

test("truncated structured bash source output stays observational", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:truncated-structured-source-output",
    type: "task.updated",
    taskId: "task:truncated-structured-source-output",
    timestamp,
    source: source("custom-agent"),
    title: "bash failure",
    summary:
      '{"wall_time":"0.0509 seconds","output":"diff --git a/src/app.ts b/src/app.ts\\n--- a/src/app.ts\\n+++ b/src/app.ts\\n@@ -1 +1 @@\\nexport const ok = true;',
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
});

test("truncated structured bash zero exits stay low-consequence status updates", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:truncated-zero-exit-output",
    type: "task.updated",
    taskId: "task:truncated-zero-exit-output",
    timestamp,
    source: source("custom-agent"),
    title: "bash failure",
    summary:
      '{"exit_code":0,"wall_time":"0 seconds","output":"dict[str, torch.Tensor]\\nA dictionary containing converted weights.',
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
});

test("truncated structured edit source output stays observational", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:truncated-edit-source-output",
    type: "task.updated",
    taskId: "task:truncated-edit-source-output",
    timestamp,
    source: source("custom-agent"),
    title: "edit failure",
    summary:
      '{"wall_time":"0.0509 seconds","output":"src/kernel.cu:12:__global__ void run() {}\\nsrc/kernel.cu:13:return;',
    status: "failed",
    toolFamily: "edit",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
});

test("truncated structured listing output stays observational at medium consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:truncated-listing-output",
    type: "task.updated",
    taskId: "task:truncated-listing-output",
    timestamp,
    source: source("custom-agent"),
    title: "bash failure",
    summary:
      '{"wall_time":"0.0510 seconds","output":"Total output lines: 106\\n\\nsrc/runtime/trap_handler.s:71:.set TTMP6_SPI_TTMPS_SETUP_DISABLED_SHIFT , 31',
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "medium");
  assert.equal(interpretation.whyNow, undefined);
});

test("truncated structured doc path listing output stays observational at medium consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:truncated-doc-listing-output",
    type: "task.updated",
    taskId: "task:truncated-doc-listing-output",
    timestamp,
    source: source("custom-agent"),
    title: "bash failure",
    summary:
      '{"wall_time":"0.0510 seconds","output":"Total output lines: 42\\n\\n/repo/README.md:17:Build the project from a clean checkout',
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "medium");
});

test("truncated structured line-numbered source intro stays observational at high consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:truncated-line-numbered-source-intro",
    type: "task.updated",
    taskId: "task:truncated-line-numbered-source-intro",
    timestamp,
    source: source("custom-agent"),
    title: "bash failure",
    summary:
      '{"wall_time":"0.0510 seconds","output":"1\\timport os\\n2\\tfrom pathlib import Path\\n3\\tclass Runner:',
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
  assert.equal(
    interpretation.whyNow,
    "A failed status carried high-consequence observation output that should be reviewed.",
  );
});

test("recovered structured technical manual excerpts stay medium-consequence observations", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:recovered-technical-manual-output",
    type: "task.updated",
    taskId: "task:recovered-technical-manual-output",
    timestamp,
    source: source("custom-agent"),
    title: "exec_command failure",
    summary:
      '{"wall_time":"0.0501 seconds","output":"2300\\t\\n 2301\\t3.4. Wave State Registers\\n 2302\\t\\n 2303\\t21 of 644\\n 2304\\t\\n 2305\\t\\n\\"RDNA3.5\\" Instruction Set Architecture\\n 2306\\t\\n 2307\\t3.4.2. Mode register\\n 2308\\t\\n 2309\\tMode register ...',
    status: "failed",
    toolFamily: "exec_command",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "medium");
});

test("explicit command-owned flattened source stays observational at high consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:raw-command-flattened-source",
    type: "task.updated",
    taskId: "task:raw-command-flattened-source",
    timestamp,
    source: source("custom-agent"),
    title: "bash failure",
    summary:
      'import functools import os from pathlib import Path from torch.utils.cpp_extension import _import_module_from_library, load def get_rocm_lib_dirs() -> list[str]: rocm_lib_dirs = [] for env_var in ("ROCM_HOME", "ROCM_PATH"): rocm_home = o...',
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
  assert.equal(
    interpretation.whyNow,
    "A failed status carried high-consequence observation output that should be reviewed.",
  );
});

test("arrow-numbered read source stays observational at high consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:arrow-numbered-read-source",
    type: "task.updated",
    taskId: "task:arrow-numbered-read-source",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      "1\u2192import os 2\u2192from functools import lru_cache 3\u2192from typing import Optional 4\u2192 5\u2192import torch 6\u2192from torch.utils.cpp_extension import load_inline 7\u2192import time 8\u2192 9\u2192 10\u2192@lru_cache(maxsize=1) 11\u2192def _load_hip_extension(): 12\u2192 source_path \u2026",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
  assert.equal(
    interpretation.whyNow,
    "A failed status carried high-consequence observation output that should be reviewed.",
  );
});

test("flattened read-owned TypeScript source stays observational at high consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:flattened-read-typescript-source",
    type: "task.updated",
    taskId: "task:flattened-read-typescript-source",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      '/** * Interactive mode for the coding agent. */ import * as crypto from "node:crypto"; import * as fs from "node:fs"; import * as os from "node:os";...',
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
  assert.equal(
    interpretation.whyNow,
    "A failed status carried high-consequence observation output that should be reviewed.",
  );
});

test("arrow-numbered read documents stay observational at high consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:arrow-numbered-read-document",
    type: "task.updated",
    taskId: "task:arrow-numbered-read-document",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      "1\u2192# Project Guide 2\u2192## Build 3\u2192- Configure the project 4\u2192- Run tests",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
});

test("flattened read-owned markdown technical documents stay medium observations", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:flattened-read-markdown-document",
    type: "task.updated",
    taskId: "task:flattened-read-markdown-document",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      "# @mariozechner/pi-tui Minimal terminal UI framework with differential rendering and synchronized output for interactive CLI applications. ## Features - **Differential Rendering**: Three-strategy rendering system - **Components**: Reusable terminal widgets...",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "medium");
  assert.equal(interpretation.whyNow, undefined);
});

test("failed read markdown documents stay status updates", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-markdown-document",
    type: "task.updated",
    taskId: "task:read-markdown-document",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      "# Project Guide\n## Build\n1. Configure the project with the documented cache settings\n2. Run the build from a clean directory\n3. Copy the resulting module into the local plugin directory\n```sh\ncmake -B build\ncmake --build build\n```",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
});

test("failed read build logs stay low-consequence status updates", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-build-log",
    type: "task.updated",
    taskId: "task:read-build-log",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      "DKMS make.log for module 1.0\nBuilding module(s)\nchecking for a BSD-compatible install... /usr/bin/install -c check",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
});

test("failed flattened read build logs stay low-consequence status updates", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-flattened-build-log",
    type: "task.updated",
    taskId: "task:read-flattened-build-log",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      "DKMS (dkms-3.2.0) make.log for amdgpu/1.0 Building module(s) # command: 'make' KERNELVER=6.19.0 checking for a BSD-compatible install... /usr/bin/install -c",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
});

test("raw read source failures stay observational while preserving high attention", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:raw-read-source-observation",
    type: "task.updated",
    taskId: "task:raw-read-source-observation",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary: '#include <stdexcept>\nint main() { throw new Error("permission denied"); return 0; }',
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "high");
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

test("error-looking filenames alone do not turn failed reads into observational status updates", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:error-looking-filename",
    type: "task.updated",
    taskId: "task:error-looking-filename",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary: "Failed to read /repo/README_FAILED_TESTS.md because the file does not exist",
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
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash failure",
    summary:
      "OBSERVATION: Form is valid: False. Form errors: amount required. Decompress result: [None, 'USD']",
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
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash observation",
    summary: "Your command ran successfully and did not produce any output.",
    status: "running",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
});

test("public trajectory failed-status bash success observations stay low-consequence status updates", () => {
  const event: SourceEvent = {
    id: "evt:public-cleanup-status-conflict",
    type: "task.updated",
    taskId: "task:public-cleanup-status-conflict",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash failure",
    summary: "Your command ran successfully and did not produce any output.",
    status: "failed",
    toolFamily: "bash",
  };
  const interpretation = interpretSourceEvent(event);
  const normalized = normalizeSourceEvent(event);

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
  assert.equal(interpretation.whyNow, undefined);
  assert.deepEqual(interpretation.factors, ["task.updated", "failed", "observational_failure"]);
  assert.equal(normalized.type, "task.updated");
  if (normalized.type === "task.updated") {
    assert.equal(normalized.status, "failed");
    assert.equal(normalized.activityClass, "status_update");
    assert.equal(normalized.semantic.activityClass, "status_update");
    assert.equal(normalized.semantic.consequence, "low");
  }
});

test("observation status prefixes are stripped case-insensitively", () => {
  const event: SourceEvent = {
    id: "evt:uppercase-observation-status-prefix",
    type: "task.updated",
    taskId: "task:uppercase-observation-status-prefix",
    timestamp,
    source: source("custom-agent"),
    title: "BASH failure Your command ran successfully and did not produce any output.",
    status: "failed",
    toolFamily: "bash",
  };
  const interpretation = interpretSourceEvent(event);
  const normalized = normalizeSourceEvent(event);

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
  assert.equal(normalized.type, "task.updated");
  if (normalized.type === "task.updated") {
    assert.equal(normalized.semantic.consequence, "low");
  }
});

test("public trajectory missing-tool file creation observations stay low-consequence status updates", () => {
  const event: SourceEvent = {
    id: "evt:public-file-created-status-conflict",
    type: "task.updated",
    taskId: "task:public-file-created-status-conflict",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "tool failure",
    summary: "OBSERVATION: File created successfully at: /testbed/exception_test.py",
    status: "failed",
  };
  const interpretation = interpretSourceEvent(event);
  const normalized = normalizeSourceEvent(event);

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "low");
  assert.equal(interpretation.whyNow, undefined);
  assert.deepEqual(interpretation.factors, ["task.updated", "failed", "observational_failure"]);
  assert.equal(normalized.type, "task.updated");
  if (normalized.type === "task.updated") {
    assert.equal(normalized.status, "failed");
    assert.equal(normalized.activityClass, "status_update");
    assert.equal(normalized.semantic.activityClass, "status_update");
    assert.equal(normalized.semantic.consequence, "low");
    assert.equal(normalized.semantic.toolFamily, undefined);
  }
});

test("public trajectory known-command file creation text stays failed status", () => {
  const event: SourceEvent = {
    id: "evt:public-command-file-created-failure",
    type: "task.updated",
    taskId: "task:public-command-file-created-failure",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash failure",
    summary: "OBSERVATION: File created successfully at: /testbed/exception_test.py",
    status: "failed",
    toolFamily: "bash",
  };
  const interpretation = interpretSourceEvent(event);
  const normalized = normalizeSourceEvent(event);

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
  assert.equal(normalized.type, "task.updated");
  if (normalized.type === "task.updated") {
    assert.equal(normalized.status, "failed");
    assert.equal(normalized.activityClass, "tool_failure");
    assert.equal(normalized.semantic.activityClass, "tool_failure");
    assert.equal(normalized.semantic.consequence, "high");
    assert.equal(normalized.semantic.toolFamily, "bash");
  }
});

test("public trajectory explicit flattened observations keep status without inferring tool family", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:public-flattened-observation",
    type: "task.updated",
    taskId: "task:public-flattened-observation",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "tool failure",
    summary:
      "OBSERVATION: def check(conf, token, prev, next, nextnext, context): if (conf['forbid'] is True and isinstance(token, yaml.FlowSequenceStartToken)): yield LintProblem(token.start_mark.line + 1, token.end_mark.column + 1, 'forbidden flow s...",
    status: "failed",
  });

  assert.equal(normalized.type, "task.updated");
  if (normalized.type === "task.updated") {
    assert.equal(normalized.status, "failed");
    assert.equal(normalized.activityClass, "status_update");
    assert.equal(normalized.semantic.activityClass, "status_update");
    assert.equal(normalized.semantic.toolFamily, undefined);
    assert.equal(normalized.semantic.consequence, "high");
  }
});

test("public trajectory failed-status bash exit-code zero observations stay low-consequence status updates", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:public-json-exit-zero",
    type: "task.updated",
    taskId: "task:public-json-exit-zero",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash failure",
    summary: '{"exit_code":0,"wall_time":"0 seconds","output":"ok"}',
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(normalized.type, "task.updated");
  if (normalized.type === "task.updated") {
    assert.equal(normalized.status, "failed");
    assert.equal(normalized.activityClass, "status_update");
    assert.equal(normalized.semantic.activityClass, "status_update");
    assert.equal(normalized.semantic.consequence, "low");
  }
});

test("public trajectory tool-use rejection outcomes stay low-consequence status updates", () => {
  const bash = normalizeSourceEvent({
    id: "evt:public-bash-tool-use-rejection",
    type: "task.updated",
    taskId: "task:public-bash-tool-use-rejection",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    toolFamily: "bash",
  });
  const edit = normalizeSourceEvent({
    id: "evt:public-edit-tool-use-rejection",
    type: "task.updated",
    taskId: "task:public-edit-tool-use-rejection",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "edit failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    toolFamily: "edit",
  });
  const absent = normalizeSourceEvent({
    id: "evt:public-absent-tool-use-rejection",
    type: "task.updated",
    taskId: "task:public-absent-tool-use-rejection",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "tool failure",
    summary: rejectedToolUseMessage,
    status: "failed",
  });

  assert.equal(bash.type, "task.updated");
  assert.equal(edit.type, "task.updated");
  assert.equal(absent.type, "task.updated");
  if (
    bash.type !== "task.updated" ||
    edit.type !== "task.updated" ||
    absent.type !== "task.updated"
  ) {
    return;
  }

  assert.equal(bash.semantic.intentFrame, "status_update");
  assert.equal(bash.semantic.activityClass, "status_update");
  assert.equal(bash.semantic.toolFamily, "bash");
  assert.equal(bash.semantic.consequence, "low");
  assert.equal(edit.semantic.intentFrame, "status_update");
  assert.equal(edit.semantic.activityClass, "status_update");
  assert.equal(edit.semantic.toolFamily, "edit");
  assert.equal(edit.semantic.consequence, "low");
  assert.equal(absent.semantic.intentFrame, "status_update");
  assert.equal(absent.semantic.activityClass, "status_update");
  assert.equal(absent.semantic.toolFamily, undefined);
  assert.equal(absent.semantic.consequence, "low");
});

test("tool-use rejection outcome disables text-only tool inference from conditional edit wording", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-absent-tool-use-rejection-no-inferred-edit",
    type: "task.updated",
    taskId: "task:public-absent-tool-use-rejection-no-inferred-edit",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "tool failure",
    summary: rejectedToolUseMessage,
    status: "failed",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.toolFamily, undefined);
  assert.equal(interpretation.consequence, "low");
});

test("missing-tool successful test and abbreviated file-view transcripts stay low status updates", () => {
  for (const [id, summary] of [
    ["successful-test", successfulTestObservationTranscript],
    ["abbreviated-file-view", abbreviatedFileViewObservationTranscript],
  ] as const) {
    const event: SourceEvent = {
      id: `evt:public-${id}-observation-transcript`,
      type: "task.updated",
      taskId: `task:public-${id}-observation-transcript`,
      timestamp,
      source: { id: "trajectory-fixture", kind: "public-trajectory" },
      title: "tool failure",
      summary,
      status: "failed",
    };
    const interpretation = interpretSourceEvent(event);
    const normalized = normalizeSourceEvent(event);

    assert.equal(interpretation.intentFrame, "status_update");
    assert.equal(interpretation.activityClass, "status_update");
    assert.equal(interpretation.toolFamily, undefined);
    assert.equal(interpretation.consequence, "low");
    assert.equal(normalized.type, "task.updated");
    if (normalized.type !== "task.updated") {
      return;
    }
    assert.equal(normalized.toolFamily, undefined);
    assert.equal(normalized.activityClass, "status_update");
    assert.equal(normalized.semantic.toolFamily, undefined);
    assert.equal(normalized.semantic.activityClass, "status_update");
    assert.equal(normalized.semantic.consequence, "low");
  }
});

test("public trajectory zero-exit outputs with explicit failures stay high-consequence failures", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-zero-exit-with-failure",
    type: "task.updated",
    taskId: "task:public-zero-exit-with-failure",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash failure",
    summary: "Tests failed. Process exit code was 0.",
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.whyNow, "Work has failed and should be reviewed.");
});

test("public trajectory failed-status bash tracebacks remain high-consequence failures", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-traceback",
    type: "task.updated",
    taskId: "task:public-traceback",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash observation",
    summary: "Traceback (most recent call last): Error: subprocess failed.",
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.whyNow, "Work has failed and should be reviewed.");
});

test("public trajectory bare nonzero bash exits remain failures with medium consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-bare-nonzero-exit",
    type: "task.updated",
    taskId: "task:public-bare-nonzero-exit",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash failure",
    summary: "(no output) Command exited with code 1",
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "medium");
  assert.equal(interpretation.whyNow, "Work has failed and should be reviewed.");
  assert.equal(interpretation.provenance?.consequence, "inferred");
});

test("public trajectory structured outcome-only exits match raw bare-exit semantics", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-structured-outcome-only-exit",
    type: "task.updated",
    taskId: "task:public-structured-outcome-only-exit",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "exec_command failure",
    summary: '{"exit_code":1,"wall_time":"0.0510 seconds","output":"(no output)"}',
    status: "failed",
    toolFamily: "exec_command",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "medium");
  assert.equal(interpretation.confidence, "high");
  assert.equal(interpretation.provenance?.consequence, "inferred");
});

test("truncated source evidence hints keep failed outcome-only exits high consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-truncated-outcome-only-exit",
    type: "task.updated",
    taskId: "task:public-truncated-outcome-only-exit",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "exec_command failure",
    summary: '{"exit_code":1,"wall_time":"0.0510 seconds","output":"(no output)"}',
    status: "failed",
    toolFamily: "exec_command",
    metadata: { truncated: true },
    semanticHints: semanticHintsForTruncatedSourceEvidence({ status: "failed" }),
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.confidence, "low");
  assert.equal(interpretation.provenance?.consequence, "hint");
  assert.equal(interpretation.provenance?.confidence, "hint");
});

test("public trajectory benign then real terminal wording stays high-consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-benign-then-terminal",
    type: "task.updated",
    taskId: "task:public-benign-then-terminal",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash observation",
    summary: "No exception occurred during setup; an exception escaped during cleanup.",
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.whyNow, "Work has failed and should be reviewed.");
});

test("public trajectory failed-status bash JSON nonzero exits remain high-consequence failures", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-json-nonzero-exit",
    type: "task.updated",
    taskId: "task:public-json-nonzero-exit",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash failure",
    summary:
      '{"exit_code":1,"wall_time":"2.9 seconds","output":"Traceback (most recent call last): RuntimeError"}',
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.whyNow, "Work has failed and should be reviewed.");
});

test("public trajectory mixed bash success and terminal failures remain high-consequence failures", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-mixed-bash-failure",
    type: "task.updated",
    taskId: "task:public-mixed-bash-failure",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash failure",
    summary:
      "Your command ran successfully and did not produce any output. Traceback follows from the next repro step.",
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.whyNow, "Work has failed and should be reviewed.");
});

test("public trajectory mixed bash success and exit-code failures remain high-consequence failures", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:public-mixed-exit-code-failure",
    type: "task.updated",
    taskId: "task:public-mixed-exit-code-failure",
    timestamp,
    source: { id: "trajectory-fixture", kind: "public-trajectory" },
    title: "bash failure",
    summary:
      "Your command ran successfully and did not produce any output. Error: deployment failed with exit code 1.",
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.whyNow, "Work has failed and should be reviewed.");
});

test("passive waiting approval wording stays status-shaped without inventing an implied ask", () => {
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
    assert.equal(normalized.semantic?.whyNow, undefined);
    assert.equal(normalized.semantic?.confidence, "high");
    assert.deepEqual(normalized.semantic?.reasons, [
      "task update carries a non-blocking lifecycle status",
    ]);
  }
});

test("task updates can infer blocked-work semantics from waiting status text", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:semantic-blocking",
    type: "task.updated",
    taskId: "task:semantic-blocking",
    timestamp,
    source: source("custom-agent"),
    title: "Cannot continue until credentials are provided",
    summary: "Work is waiting but cannot proceed until the operator provides credentials.",
    status: "waiting",
  });

  assert.equal(normalized.type, "task.updated");
  if (normalized.type === "task.updated") {
    assert.equal(normalized.semantic?.intentFrame, "blocked_work");
    assert.equal(
      normalized.semantic?.whyNow,
      "Work is blocked and may require operator attention.",
    );
    assert.equal(normalized.semantic?.confidence, "medium");
    assert.ok(
      normalized.semantic?.reasons.includes("status wording indicates work cannot continue yet"),
    );
  }
});

test("task updates still infer implied operator asks from operator-directed status text", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:direct-ask-status",
    type: "task.updated",
    taskId: "task:direct-ask-status",
    timestamp,
    source: source("custom-agent"),
    title: "Need your approval before continuing",
    summary: "Can you approve the deploy so work can continue?",
    status: "waiting",
  });

  assert.equal(normalized.type, "task.updated");
  if (normalized.type === "task.updated") {
    assert.equal(
      normalized.semantic?.whyNow,
      "Status text implies the operator may need to respond.",
    );
    assert.equal(normalized.semantic?.confidence, "low");
    assert.ok(
      normalized.semantic?.reasons.includes("status wording suggests an implied operator request"),
    );
  }
});

test("passive review wording does not infer an operator ask from status text", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:passive-review-status",
    type: "task.updated",
    taskId: "task:passive-review-status",
    timestamp,
    source: source("custom-agent"),
    title: "Logs attached for review",
    summary: "Build logs are attached, please review when convenient.",
    status: "running",
  });

  assert.equal(normalized.type, "task.updated");
  if (normalized.type === "task.updated") {
    assert.equal(normalized.semantic?.whyNow, undefined);
    assert.equal(normalized.semantic?.confidence, "high");
    assert.deepEqual(normalized.semantic?.reasons, [
      "task update carries a non-blocking lifecycle status",
    ]);
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

  assert.deepEqual(
    repeated.relationHints.map((hint) => hint.kind),
    ["same_issue", "repeats"],
  );
  assert.deepEqual(
    resolved.relationHints.map((hint) => hint.kind),
    ["same_issue", "resolves"],
  );
  assert.equal(
    resolved.whyNow,
    "A related episode appears resolved and can update attention state.",
  );
  assert.equal(resolved.provenance?.whyNow, "inferred");
});

test("prospective verification wording does not infer resolved episode semantics", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:verify-resolution",
    type: "task.updated",
    taskId: "task:verify-resolution",
    timestamp,
    source: source("custom-agent"),
    title: "Verify build issue",
    summary: "Run the script again to confirm that the issue is fixed.",
    status: "running",
  });

  assert.equal(
    interpretation.relationHints.some((hint) => hint.kind === "resolves"),
    false,
  );
  assert.notEqual(
    interpretation.whyNow,
    "A related episode appears resolved and can update attention state.",
  );
  assert.notEqual(interpretation.provenance?.whyNow, "inferred");
});

test("question resolution wording does not infer resolved episode semantics", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:question-resolution",
    type: "task.updated",
    taskId: "task:question-resolution",
    timestamp,
    source: source("custom-agent"),
    title: "Check build issue",
    summary: "Can you confirm the issue was fixed?",
    status: "waiting",
  });

  assert.equal(
    interpretation.relationHints.some((hint) => hint.kind === "resolves"),
    false,
  );
  assert.notEqual(
    interpretation.whyNow,
    "A related episode appears resolved and can update attention state.",
  );
});

test("separate asserted recovery clauses still infer resolved episode semantics", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:separate-recovery-clause",
    type: "task.updated",
    taskId: "task:separate-recovery-clause",
    timestamp,
    source: source("custom-agent"),
    title: "Verify dashboards now",
    summary: "The production outage recovered after rollback.",
    status: "completed",
  });

  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    ["same_issue", "resolves"],
  );
  assert.equal(
    interpretation.whyNow,
    "A related episode appears resolved and can update attention state.",
  );
});

test("prior negated resolution clauses do not suppress later asserted recovery semantics", () => {
  const event = {
    id: "evt:mixed-resolution-polarity",
    type: "task.updated",
    taskId: "task:mixed-resolution-polarity",
    timestamp,
    source: source("custom-agent"),
    title: "Build issue update",
    summary: "The issue was not fixed before. It is fixed now.",
    status: "completed",
  } satisfies SourceEvent;
  const interpretation = interpretSourceEvent(event);
  const ontology = readAttentionOntologyDiagnostic(event, interpretation);

  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    ["same_issue", "resolves"],
  );
  assert.equal(ontology.episode, "resolved");
  assert.equal(
    interpretation.whyNow,
    "A related episode appears resolved and can update attention state.",
  );
});

test("later negated resolution clauses prevent stale resolved episode semantics", () => {
  const event = {
    id: "evt:stale-resolution-polarity",
    type: "task.updated",
    taskId: "task:stale-resolution-polarity",
    timestamp,
    source: source("custom-agent"),
    title: "Build issue update",
    summary: "The issue was fixed yesterday. It is not fixed now.",
    status: "failed",
  } satisfies SourceEvent;
  const interpretation = interpretSourceEvent(event);
  const ontology = readAttentionOntologyDiagnostic(event, interpretation);

  assert.deepEqual(interpretation.relationHints, []);
  assert.notEqual(ontology.episode, "resolved");
  assert.notEqual(
    interpretation.whyNow,
    "A related episode appears resolved and can update attention state.",
  );
});

test("later asserted resurfacing clauses override stale resolved episode semantics", () => {
  const event = {
    id: "evt:latest-resurfacing-relation",
    type: "task.updated",
    taskId: "task:latest-resurfacing-relation",
    timestamp,
    source: source("custom-agent"),
    title: "Build issue update",
    summary: "The issue was fixed yesterday, but regressed today.",
    status: "failed",
  } satisfies SourceEvent;
  const interpretation = interpretSourceEvent(event);
  const ontology = readAttentionOntologyDiagnostic(event, interpretation);

  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    ["same_issue", "escalates"],
  );
  assert.equal(ontology.episode, "resurfaced");
  assert.notEqual(
    interpretation.whyNow,
    "A related episode appears resolved and can update attention state.",
  );
});

test("later asserted resolution clauses override stale resurfacing semantics", () => {
  const event = {
    id: "evt:latest-resolution-relation",
    type: "task.updated",
    taskId: "task:latest-resolution-relation",
    timestamp,
    source: source("custom-agent"),
    title: "Build issue update",
    summary: "The issue regressed yesterday, but it is fixed today.",
    status: "completed",
  } satisfies SourceEvent;
  const interpretation = interpretSourceEvent(event);
  const ontology = readAttentionOntologyDiagnostic(event, interpretation);

  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    ["same_issue", "resolves"],
  );
  assert.equal(ontology.episode, "resolved");
  assert.equal(
    interpretation.whyNow,
    "A related episode appears resolved and can update attention state.",
  );
});

test("generic successful completion wording does not infer a resolved episode by itself", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:generic-success",
    type: "task.updated",
    taskId: "task:generic-success",
    timestamp,
    source: source("custom-agent"),
    title: "Read completed successfully",
    summary: "Read completed successfully.",
    status: "completed",
  });

  assert.deepEqual(interpretation.relationHints, []);
  assert.equal(interpretation.whyNow, undefined);
});

test("recovery wording with issue context still infers a resolved episode", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:recovered-issue",
    type: "task.updated",
    taskId: "task:recovered-issue",
    timestamp,
    source: source("custom-agent"),
    title: "Service recovered after outage",
    summary: "The production outage recovered after rollback.",
    status: "completed",
  });

  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    ["same_issue", "resolves"],
  );
  assert.equal(
    interpretation.whyNow,
    "A related episode appears resolved and can update attention state.",
  );
});

test("human input can infer low-confidence superseding relation hints from wording", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:rollback-instead",
    type: "human.input.requested",
    taskId: "task:rollback-instead",
    interactionId: "interaction:rollback-instead",
    timestamp,
    source: source("custom-agent"),
    title: "Approve rollback instead",
    summary: "Use this rollback plan instead for the same production deploy.",
    request: { kind: "approval" },
  });

  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    ["same_issue", "supersedes"],
  );
  assert.equal(interpretation.confidence, "low");
  assert.equal(interpretation.provenance?.relationHints, "inferred");
});

test("targeted semantic hints refine targetless inferred relation hints", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:rollback-targeted",
    type: "human.input.requested",
    taskId: "task:rollback-targeted",
    interactionId: "interaction:rollback-targeted",
    timestamp,
    source: source("custom-agent"),
    title: "Approve rollback instead",
    summary: "Use this rollback plan instead for the same production deploy.",
    request: { kind: "approval" },
    semanticHints: {
      relationHints: [
        { kind: "same_issue", target: "issue:deploy:prod" },
        { kind: "supersedes", target: "issue:deploy:prod" },
      ],
    },
  });

  assert.deepEqual(interpretation.relationHints, [
    { kind: "same_issue", target: "issue:deploy:prod" },
    { kind: "supersedes", target: "issue:deploy:prod" },
  ]);
  assert.equal(interpretation.provenance?.relationHints, "hint");
});

test("duplicate source relation hints collapse without dropping conflicting targets", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:duplicate-relation-hints",
    type: "human.input.requested",
    taskId: "task:duplicate-relation-hints",
    interactionId: "interaction:duplicate-relation-hints",
    timestamp,
    source: source("custom-agent"),
    title: "Approve deploy follow-up",
    summary: "Review related deploy work.",
    request: { kind: "approval" },
    semanticHints: {
      relationHints: [
        { kind: "same_issue", target: "issue:deploy:primary" },
        { kind: "same_issue", target: "issue:deploy:primary" },
        { kind: "same_issue", target: "issue:deploy:secondary" },
      ],
    },
  });

  assert.deepEqual(interpretation.relationHints, [
    { kind: "same_issue", target: "issue:deploy:primary" },
    { kind: "same_issue", target: "issue:deploy:secondary" },
  ]);
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
    summary:
      "OBSERVATION: Form is valid: False Form errors: <ul class=\"errorlist\"><li>This field is required.</li></ul> Decompress result: [None, 'USD']",
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

test("choice requests still preserve explicit event tool family as semantic-only", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:question-explicit-tool-family",
    type: "human.input.requested",
    taskId: "task:question-explicit-tool-family",
    interactionId: "interaction:question-explicit-tool-family",
    timestamp,
    source: source("custom-agent"),
    title: "Should we read the config first?",
    summary: "Choose the next step.",
    toolFamily: "read",
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
  assert.ok(interpretation.reasons.includes("tool family was supplied by the source event"));
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
    toolFamily: "read",
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
    context: {
      items: [{ id: "issue", label: "Issue", value: "issue:deploy:prod" }],
    },
  };
  const normalizedEvent = normalizeSourceEvent(sourceEvent);
  const sourceCore = new ApertureCore();
  const eventCore = new ApertureCore();

  sourceCore.publishSourceEvent(sourceEvent);
  eventCore.publish(normalizedEvent);

  assert.deepEqual(
    sourceCore.getTaskView(sourceEvent.taskId),
    eventCore.getTaskView(sourceEvent.taskId),
  );
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

  assert.deepEqual(
    sourceCore.getTaskView(sourceEvent.taskId),
    eventCore.getTaskView(sourceEvent.taskId),
  );
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
    summary:
      "Dependency fetch is blocked, but the semantic read abstains until clearer evidence arrives.",
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

  assert.deepEqual(
    sourceCore.getTaskView(sourceEvent.taskId),
    eventCore.getTaskView(sourceEvent.taskId),
  );
  assert.deepEqual(sourceCore.getAttentionView(), eventCore.getAttentionView());
});
