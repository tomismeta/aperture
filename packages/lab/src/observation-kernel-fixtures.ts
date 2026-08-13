import type { SourceEvent } from "@tomismeta/aperture-core";

import { OBSERVATION_KERNEL_HOLDOUT_FIXTURES } from "./observation-kernel-holdout.js";

export type ObservationKernelFixture = {
  id: string;
  dimension: string;
  split: ObservationKernelFixtureSplit;
  events: SourceEvent[];
};

export type ObservationKernelFixtureSplit = "calibration" | "holdout";

const rejectedToolUseMessage =
  "Authorization was declined before invocation. No tool call occurred and no result exists.";

const OBSERVATION_KERNEL_CALIBRATION_FIXTURES: ObservationKernelFixture[] = [
  fixture("bare-nonzero-command-exit", "outcome_failure", {
    title: "bash failure",
    summary: "(no output) Command exited with code 1",
    toolFamily: "bash",
  }),
  fixture("empty-edit-payload", "absent_evidence", {
    title: "edit failure",
    summary: "{}",
    toolFamily: "edit",
  }),
  fixture("read-source-window-limit", "partial_source_diagnostic", {
    title: "read failure",
    summary:
      "File content (347.9KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.",
    toolFamily: "read",
  }),
  fixture("runtime-traceback", "runtime_diagnostic", {
    title: "bash failure",
    summary: "Traceback (most recent call last): RuntimeError: fixture failed",
    toolFamily: "bash",
  }),
  fixture("expected-diagnostic-output", "expected_diagnostic", {
    title: "bash failure",
    summary:
      "OBSERVATION: Form is valid: False. Form errors: amount required. Decompress result: [None, 'USD']",
    toolFamily: "bash",
  }),
  fixture("edit-applied-readback", "tool_payload_observation", {
    title: "edit failure",
    summary:
      "Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\nexport const value = 1;",
    toolFamily: "edit",
  }),
  fixture("file-created-observation", "source_success_observation", {
    title: "tool failure",
    summary: "OBSERVATION: File created successfully at: /testbed/exception_test.py",
  }),
  fixture("rejected-tool-use", "control_authorization_observation", {
    title: "bash failure",
    summary: rejectedToolUseMessage,
    toolFamily: "bash",
  }),
  fixture("abbreviated-read-view", "read_payload_observation", {
    title: "read failure",
    summary:
      "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE> 1 # fmt: off 2 from __future__ import annotations",
    toolFamily: "read",
  }),
  fixture("command-test-progress", "command_output_observation", {
    title: "bash failure",
    summary: "OBSERVATION: === Testing quote formatting === All quote formatting tests passed!",
    toolFamily: "bash",
  }),
  fixture("host-neutral-command-success-title", "host_neutral_title_invariance", {
    title: "Command status",
    summary: "Your command ran successfully and did not produce any output.",
    toolFamily: "exec_command",
  }),
  fixture("ambiguous-terminal-output", "indeterminate_terminal_evidence", {
    title: "tool failure",
    summary: "Command exited with code 1 after producing output that did not include a diagnostic.",
  }),
  fixture("structured-output-source-readback", "structured_output_payload", {
    title: "bash failure",
    summary:
      '{"exit_code":0,"wall_time":"0.125 seconds","output":"/repo/src/app.ts:1:export const value = 1;"}',
    toolFamily: "bash",
  }),
  {
    id: "explicit-tool-family-authority",
    dimension: "explicit_tool_family_authority",
    split: "calibration",
    events: [
      failedTaskEvent({
        id: "evt:observation:explicit-tool-family-authority:command",
        taskId: "task:observation:explicit-tool-family-authority",
        title: "tool failure",
        summary: "Your command ran successfully and did not produce any output.",
        toolFamily: "exec_command",
      }),
      failedTaskEvent({
        id: "evt:observation:explicit-tool-family-authority:structured",
        taskId: "task:observation:explicit-tool-family-authority",
        title: "tool failure",
        summary:
          '{"exit_code":0,"wall_time":"0.125 seconds","output":"/repo/pkg/lib.rs:10:fn main() {}"}',
        toolFamily: "custom_runner",
      }),
    ],
  },
  fixture("search-result-output", "search_output_payload", {
    title: "search failure",
    summary: 'Web search results for "aperture": /repo/README.md: Aperture overview',
    toolFamily: "search",
  }),
  {
    id: "source-limit-recovery-flow",
    dimension: "source_limit_recovery_flow",
    split: "calibration",
    events: [
      failedTaskEvent({
        id: "evt:observation:source-limit-recovery-flow:limit",
        taskId: "task:observation:source-limit-recovery-flow",
        title: "read failure",
        summary:
          "File content (410KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file.",
        toolFamily: "read",
        semanticHints: { confidence: "medium" },
      }),
      failedTaskEvent({
        id: "evt:observation:source-limit-recovery-flow:narrowed-read",
        taskId: "task:observation:source-limit-recovery-flow",
        title: "read failure",
        summary:
          "OBSERVATION: Here's the result of running `cat -n` on /repo/src/app.ts: 120 export function render() { 121 return true; }",
        toolFamily: "read",
      }),
    ],
  },
];

function fixture(
  id: string,
  dimension: string,
  input: Omit<FailedTaskEventInput, "id" | "taskId">,
): ObservationKernelFixture {
  return {
    id,
    dimension,
    split: "calibration",
    events: [
      failedTaskEvent({
        id: `evt:observation:${id}`,
        taskId: `task:observation:${id}`,
        ...input,
      }),
    ],
  };
}

type FailedTaskEventInput = {
  id: string;
  taskId: string;
  title: string;
  summary: string;
  toolFamily?: string;
  context?: { items?: Array<{ id: string; label: string; value?: string }> };
  semanticHints?: SourceEvent["semanticHints"];
};

function failedTaskEvent(input: FailedTaskEventInput): SourceEvent {
  return {
    id: input.id,
    taskId: input.taskId,
    timestamp: "2026-04-22T18:30:00.000Z",
    type: "task.updated",
    title: input.title,
    summary: input.summary,
    status: "failed",
    ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.semanticHints !== undefined ? { semanticHints: input.semanticHints } : {}),
  };
}

export const OBSERVATION_KERNEL_FIXTURES: ObservationKernelFixture[] = [
  ...OBSERVATION_KERNEL_CALIBRATION_FIXTURES,
  ...OBSERVATION_KERNEL_HOLDOUT_FIXTURES,
];
