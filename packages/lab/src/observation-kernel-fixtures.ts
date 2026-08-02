import type { SourceEvent } from "@tomismeta/aperture-core";

export type ObservationKernelFixture = {
  id: string;
  dimension: string;
  events: SourceEvent[];
};

const rejectedToolUseMessage =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

export const OBSERVATION_KERNEL_FIXTURES: ObservationKernelFixture[] = [
  fixture(
    "bare-nonzero-command-exit",
    "outcome_failure",
    failedTaskEvent({
      id: "evt:observation:bare-nonzero-command-exit",
      taskId: "task:observation:bare-nonzero-command-exit",
      title: "bash failure",
      summary: "(no output) Command exited with code 1",
      toolFamily: "bash",
    }),
  ),
  fixture(
    "empty-edit-payload",
    "absent_evidence",
    failedTaskEvent({
      id: "evt:observation:empty-edit-payload",
      taskId: "task:observation:empty-edit-payload",
      title: "edit failure",
      summary: "{}",
      toolFamily: "edit",
    }),
  ),
  fixture(
    "read-source-window-limit",
    "partial_source_diagnostic",
    failedTaskEvent({
      id: "evt:observation:read-source-window-limit",
      taskId: "task:observation:read-source-window-limit",
      title: "read failure",
      summary:
        "File content (347.9KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.",
      toolFamily: "read",
    }),
  ),
  fixture(
    "runtime-traceback",
    "runtime_diagnostic",
    failedTaskEvent({
      id: "evt:observation:runtime-traceback",
      taskId: "task:observation:runtime-traceback",
      title: "bash failure",
      summary: "Traceback (most recent call last): RuntimeError: fixture failed",
      toolFamily: "bash",
    }),
  ),
  fixture(
    "edit-applied-readback",
    "tool_payload_observation",
    failedTaskEvent({
      id: "evt:observation:edit-applied-readback",
      taskId: "task:observation:edit-applied-readback",
      title: "edit failure",
      summary:
        "Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\nexport const value = 1;",
      toolFamily: "edit",
    }),
  ),
  fixture(
    "file-created-observation",
    "source_success_observation",
    failedTaskEvent({
      id: "evt:observation:file-created-observation",
      taskId: "task:observation:file-created-observation",
      title: "tool failure",
      summary: "OBSERVATION: File created successfully at: /testbed/exception_test.py",
    }),
  ),
  fixture(
    "rejected-tool-use",
    "control_authorization_observation",
    failedTaskEvent({
      id: "evt:observation:rejected-tool-use",
      taskId: "task:observation:rejected-tool-use",
      title: "bash failure",
      summary: rejectedToolUseMessage,
      toolFamily: "bash",
    }),
  ),
  fixture(
    "abbreviated-read-view",
    "read_payload_observation",
    failedTaskEvent({
      id: "evt:observation:abbreviated-read-view",
      taskId: "task:observation:abbreviated-read-view",
      title: "read failure",
      summary:
        "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE> 1 # fmt: off 2 from __future__ import annotations",
      toolFamily: "read",
    }),
  ),
  fixture(
    "command-test-progress",
    "command_output_observation",
    failedTaskEvent({
      id: "evt:observation:command-test-progress",
      taskId: "task:observation:command-test-progress",
      title: "bash failure",
      summary: "OBSERVATION: === Testing quote formatting === All quote formatting tests passed!",
      toolFamily: "bash",
    }),
  ),
  fixture(
    "ambiguous-terminal-output",
    "indeterminate_terminal_evidence",
    failedTaskEvent({
      id: "evt:observation:ambiguous-terminal-output",
      taskId: "task:observation:ambiguous-terminal-output",
      title: "tool failure",
      summary:
        "Command exited with code 1 after producing output that did not include a diagnostic.",
    }),
  ),
  fixture(
    "structured-output-source-readback",
    "structured_output_payload",
    failedTaskEvent({
      id: "evt:observation:structured-output-source-readback",
      taskId: "task:observation:structured-output-source-readback",
      title: "bash failure",
      summary:
        '{"exit_code":0,"wall_time":"0.125 seconds","output":"/repo/src/app.ts:1:export const value = 1;"}',
      toolFamily: "bash",
    }),
  ),
  {
    id: "context-host-tool-family-parity",
    dimension: "context_host_tool_family_parity",
    events: [
      failedTaskEvent({
        id: "evt:observation:context-host-tool-family-parity:command",
        taskId: "task:observation:context-host-tool-family-parity",
        title: "tool failure",
        summary: "Your command ran successfully and did not produce any output.",
        context: { items: [{ id: "tool_family", label: "Tool family", value: "exec_command" }] },
      }),
      failedTaskEvent({
        id: "evt:observation:context-host-tool-family-parity:structured",
        taskId: "task:observation:context-host-tool-family-parity",
        title: "tool failure",
        summary:
          '{"exit_code":0,"wall_time":"0.125 seconds","output":"/repo/pkg/lib.rs:10:fn main() {}"}',
        context: { items: [{ id: "tool_family", label: "Tool family", value: "custom_runner" }] },
      }),
    ],
  },
  fixture(
    "search-result-output",
    "search_output_payload",
    failedTaskEvent({
      id: "evt:observation:search-result-output",
      taskId: "task:observation:search-result-output",
      title: "search failure",
      summary: 'Web search results for "aperture": /repo/README.md: Aperture overview',
      toolFamily: "search",
    }),
  ),
  {
    id: "source-limit-recovery-flow",
    dimension: "source_limit_recovery_flow",
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

function fixture(id: string, dimension: string, event: SourceEvent): ObservationKernelFixture {
  return { id, dimension, events: [event] };
}

function failedTaskEvent(input: {
  id: string;
  taskId: string;
  title: string;
  summary: string;
  toolFamily?: string;
  context?: { items?: Array<{ id: string; label: string; value?: string }> };
  semanticHints?: SourceEvent["semanticHints"];
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
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.semanticHints !== undefined ? { semanticHints: input.semanticHints } : {}),
  };
}
