import type { SourceEvent } from "@tomismeta/aperture-core";

export type ObservationKernelFixture = {
  id: string;
  dimension: string;
  event: SourceEvent;
};

const rejectedToolUseMessage =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

export const OBSERVATION_KERNEL_FIXTURES: ObservationKernelFixture[] = [
  {
    id: "bare-nonzero-command-exit",
    dimension: "outcome_failure",
    event: failedTaskEvent({
      id: "evt:observation:bare-nonzero-command-exit",
      taskId: "task:observation:bare-nonzero-command-exit",
      title: "bash failure",
      summary: "(no output) Command exited with code 1",
      toolFamily: "bash",
    }),
  },
  {
    id: "empty-edit-payload",
    dimension: "absent_evidence",
    event: failedTaskEvent({
      id: "evt:observation:empty-edit-payload",
      taskId: "task:observation:empty-edit-payload",
      title: "edit failure",
      summary: "{}",
      toolFamily: "edit",
    }),
  },
  {
    id: "read-source-window-limit",
    dimension: "partial_source_diagnostic",
    event: failedTaskEvent({
      id: "evt:observation:read-source-window-limit",
      taskId: "task:observation:read-source-window-limit",
      title: "read failure",
      summary:
        "File content (347.9KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.",
      toolFamily: "read",
    }),
  },
  {
    id: "runtime-traceback",
    dimension: "runtime_diagnostic",
    event: failedTaskEvent({
      id: "evt:observation:runtime-traceback",
      taskId: "task:observation:runtime-traceback",
      title: "bash failure",
      summary: "Traceback (most recent call last): RuntimeError: fixture failed",
      toolFamily: "bash",
    }),
  },
  {
    id: "edit-applied-readback",
    dimension: "tool_payload_observation",
    event: failedTaskEvent({
      id: "evt:observation:edit-applied-readback",
      taskId: "task:observation:edit-applied-readback",
      title: "edit failure",
      summary:
        "Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\nexport const value = 1;",
      toolFamily: "edit",
    }),
  },
  {
    id: "file-created-observation",
    dimension: "source_success_observation",
    event: failedTaskEvent({
      id: "evt:observation:file-created-observation",
      taskId: "task:observation:file-created-observation",
      title: "tool failure",
      summary: "OBSERVATION: File created successfully at: /testbed/exception_test.py",
    }),
  },
  {
    id: "rejected-tool-use",
    dimension: "control_authorization_observation",
    event: failedTaskEvent({
      id: "evt:observation:rejected-tool-use",
      taskId: "task:observation:rejected-tool-use",
      title: "bash failure",
      summary: rejectedToolUseMessage,
      toolFamily: "bash",
    }),
  },
  {
    id: "abbreviated-read-view",
    dimension: "read_payload_observation",
    event: failedTaskEvent({
      id: "evt:observation:abbreviated-read-view",
      taskId: "task:observation:abbreviated-read-view",
      title: "read failure",
      summary:
        "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE> 1 # fmt: off 2 from __future__ import annotations",
      toolFamily: "read",
    }),
  },
  {
    id: "command-test-progress",
    dimension: "command_output_observation",
    event: failedTaskEvent({
      id: "evt:observation:command-test-progress",
      taskId: "task:observation:command-test-progress",
      title: "bash failure",
      summary: "OBSERVATION: === Testing quote formatting === All quote formatting tests passed!",
      toolFamily: "bash",
    }),
  },
  {
    id: "ambiguous-terminal-output",
    dimension: "indeterminate_terminal_evidence",
    event: failedTaskEvent({
      id: "evt:observation:ambiguous-terminal-output",
      taskId: "task:observation:ambiguous-terminal-output",
      title: "tool failure",
      summary:
        "Command exited with code 1 after producing output that did not include a diagnostic.",
    }),
  },
];

function failedTaskEvent(input: {
  id: string;
  taskId: string;
  title: string;
  summary: string;
  toolFamily?: string;
}): SourceEvent {
  return {
    id: input.id,
    taskId: input.taskId,
    timestamp: "2026-04-22T18:30:00.000Z",
    type: "task.updated",
    title: input.title,
    summary: input.summary,
    status: "failed",
    ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
  };
}
