import assert from "node:assert/strict";
import test from "node:test";

import {
  createImportedSessionFromDataclawRow,
  createImportedSessionFromOpenAgentSessionsRow,
  createReplayScenarioFromDataclawRow,
  createReplayScenarioFromOpenAgentSessionsRow,
  createReplayScenarioFromTraceCommonsRow,
  createSessionBundleFromDataclawRow,
  createSessionBundleFromOpenAgentSessionsRow,
  createSessionBundleFromTraceCommonsRow,
  createImportedSessionFromSweSmithTrajectory,
  createImportedSessionFromTraceCommonsRow,
  defaultImportedTrajectoryBundlePath,
  createScenarioFromSweSmithRow,
  createSessionBundleFromSweSmithRow,
  extractSweSmithMessageText,
  fetchOpenAgentSessionsRows,
  fetchTraceCommonsRows,
  OPEN_AGENT_SESSIONS_SITE_URL,
  OPEN_AGENT_SESSIONS_URLS_URL,
  parseDataclawRowsResponse,
  parseSweSmithMessages,
  parseSweSmithRowsResponse,
  parseTraceCommonsRowsResponse,
  runSessionBundle,
  type DataclawRow,
  type OpenAgentSessionsRow,
  type SweSmithRow,
  type TraceCommonsRow,
} from "../src/index.js";
import { clipSourceEventSummary, normalizeToolFamily } from "../src/public-trajectories-shared.js";

const SAMPLE_ROW: SweSmithRow = {
  instance_id: "example/repo-123",
  model: "claude-3-7-sonnet-20250219",
  resolved: true,
  traj_id: "example/repo-123.run-42",
  patch: "diff --git a/file.py b/file.py\nindex 111..222 100644\n--- a/file.py\n+++ b/file.py\n@@\n-print('bad')\n+print('good')\n",
  messages: JSON.stringify([
    {
      role: "system",
      content: "You are a helpful assistant that can interact with a computer to solve tasks.",
      agent: "main",
      message_type: "system_prompt",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "We're currently solving the following issue within our repository. ISSUE:\nMoneyWidget crashes on invalid provider responses\nTraceback shows string indices must be integers.",
        },
      ],
      agent: "main",
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "I'll reproduce the failure first.",
      thought: "Reproduce before patching.",
      action: "pytest tests/test_widget.py",
      agent: "main",
      tool_calls: [
        {
          index: 0,
          function: {
            name: "bash",
            arguments: "{\"command\":\"pytest tests/test_widget.py\"}",
          },
          id: "toolu_bash",
          type: "function",
        },
      ],
      message_type: "action",
    },
    {
      role: "tool",
      content: [
        {
          type: "text",
          text: "Traceback (most recent call last): TypeError: string indices must be integers",
        },
      ],
      agent: "main",
      tool_call_ids: ["toolu_bash"],
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "I'll patch the provider handling now.",
      thought: "Apply the fix.",
      action: "apply_patch <<'PATCH' ...",
      agent: "main",
      tool_calls: [
        {
          index: 0,
          function: {
            name: "edit",
            arguments: "{\"path\":\"/testbed/provider.py\"}",
          },
          id: "toolu_edit",
          type: "function",
        },
      ],
      message_type: "action",
    },
    {
      role: "tool",
      content: [
        {
          type: "text",
          text: "Patch applied successfully.",
        },
      ],
      agent: "main",
      tool_call_ids: ["toolu_edit"],
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "",
      thought: "Done.",
      action: "submit",
      agent: "main",
      tool_calls: [
        {
          index: 0,
          function: {
            name: "submit",
            arguments: "{}",
          },
          id: "toolu_submit",
          type: "function",
        },
      ],
      message_type: "action",
    },
  ]),
};

test("public trajectory tool family normalization folds shell command aliases into bash", () => {
  assert.equal(normalizeToolFamily("bash"), "bash");
  assert.equal(normalizeToolFamily("exec_command"), "bash");
  assert.equal(normalizeToolFamily("exec-command"), "bash");
  assert.equal(normalizeToolFamily("exec command"), "bash");
  assert.equal(normalizeToolFamily("shell_command"), "bash");
  assert.equal(normalizeToolFamily("shell-command"), "bash");
  assert.equal(normalizeToolFamily("shell command"), "bash");
  assert.equal(normalizeToolFamily("run_shell_command"), "bash");
  assert.equal(normalizeToolFamily("run-shell-command"), "bash");
  assert.equal(normalizeToolFamily("run shell command"), "bash");
  assert.equal(normalizeToolFamily("command"), "command");
  assert.equal(normalizeToolFamily("unknown_tool"), "unknown_tool");
  assert.equal(normalizeToolFamily("powershell"), "powershell");
});

test("public trajectory tool family normalization folds glob into search", () => {
  assert.equal(normalizeToolFamily("glob"), "search");
  assert.equal(normalizeToolFamily("Glob"), "search");
  assert.equal(normalizeToolFamily(" glob "), "search");
  assert.equal(normalizeToolFamily("glob()"), "search");
  assert.equal(normalizeToolFamily("glob:"), "search");
  assert.equal(normalizeToolFamily("file_search"), "search");
  assert.equal(normalizeToolFamily("grep"), "search");
});

test("public trajectory tool family normalization keeps glob matches exact", () => {
  assert.equal(normalizeToolFamily("global"), "global");
  assert.equal(normalizeToolFamily("glob_files"), "glob_files");
  assert.equal(normalizeToolFamily("file_glob"), "file_glob");
  assert.equal(normalizeToolFamily("mcp__glob"), "mcp__glob");
});

const SAMPLE_DATACLAW_ROW: DataclawRow = {
  session_id: "123e4567-e89b-12d3-a456-426614174000",
  source: "claude",
  project: "demo-project",
  model: "claude-sonnet-4",
  start_time: "2026-03-28T00:00:00.000Z",
  end_time: "2026-03-28T00:05:00.000Z",
  git_branch: "main",
  stats: {
    user_messages: 2,
    assistant_messages: 4,
    tool_uses: 2,
    input_tokens: 1234,
    output_tokens: 567,
  },
  messages: [
    {
      role: "user",
      content: "<local-command-caveat>Caveat: local command output.</local-command-caveat>",
      timestamp: "2026-03-28T00:00:00.000Z",
    },
    {
      role: "user",
      content: "Add retry logic to @src/client.ts and explain the fix.",
      timestamp: "2026-03-28T00:00:10.000Z",
    },
    {
      role: "assistant",
      thinking: "I should inspect the file first.",
      content: "I'll inspect the client implementation first.",
      timestamp: "2026-03-28T00:00:20.000Z",
    },
    {
      role: "assistant",
      timestamp: "2026-03-28T00:00:30.000Z",
      tool_uses: [
        {
          tool: "Read",
          input: {
            file_path: "/workspace/src/client.ts",
          },
          output: {
            text: "1→export async function request() {\n2→  return fetch('/api');\n3→}",
          },
          status: "success",
        },
      ],
    },
    {
      role: "assistant",
      timestamp: "2026-03-28T00:01:00.000Z",
      tool_uses: [
        {
          tool: "Edit",
          input: {
            path: "/workspace/src/client.ts",
            description: "Add bounded retry logic with backoff.",
          },
          output: {
            text: "Patch applied successfully.",
          },
          status: "success",
        },
      ],
    },
    {
      role: "assistant",
      content: "I added bounded retry logic and preserved the existing timeout behavior.",
      timestamp: "2026-03-28T00:02:00.000Z",
    },
    {
      role: "user",
      content: "Can you also add a regression test?",
      timestamp: "2026-03-28T00:03:00.000Z",
    },
  ],
};

const SAMPLE_DATACLAW_GLOB_ROW: DataclawRow = {
  ...SAMPLE_DATACLAW_ROW,
  session_id: "223e4567-e89b-12d3-a456-426614174000",
  stats: {
    ...SAMPLE_DATACLAW_ROW.stats,
    tool_uses: 1,
  },
  messages: [
    {
      role: "user",
      content: "Find the hip geometry tests before making any changes.",
      timestamp: "2026-03-28T00:00:10.000Z",
    },
    {
      role: "assistant",
      content: "I'll locate matching tests first.",
      timestamp: "2026-03-28T00:00:30.000Z",
      tool_uses: [
        {
          tool: "Glob",
          input: {
            pattern: "**/test_scaled_mm_hip.py",
          },
          output: {
            files: ["tests/test_scaled_mm_hip.py"],
          },
          status: "success",
        },
      ],
    },
  ],
};

function createDataclawToolStatusRow(options: {
  sessionId: string;
  tool?: string;
  input?: unknown;
  output: unknown;
  status: string | undefined;
}): DataclawRow {
  return {
    ...SAMPLE_DATACLAW_ROW,
    session_id: options.sessionId,
    stats: {
      ...SAMPLE_DATACLAW_ROW.stats,
      tool_uses: 1,
    },
    messages: [
      {
        role: "user",
        content: "Inspect src/client.ts before changing behavior.",
        timestamp: "2026-03-28T00:00:10.000Z",
      },
      {
        role: "assistant",
        content: "I'll inspect the implementation first.",
        timestamp: "2026-03-28T00:00:30.000Z",
        tool_uses: [
          {
            tool: options.tool ?? "Read",
            input: options.input ?? {
              file_path: "/workspace/src/client.ts",
            },
            output: options.output,
            ...(options.status !== undefined ? { status: options.status } : {}),
          },
        ],
      },
    ],
  };
}

function readDataclawSingleToolResult(row: DataclawRow): {
  status?: string;
  title?: string;
  toolFamily?: string;
  stepIndex?: number;
  bundle: ReturnType<typeof createSessionBundleFromDataclawRow>;
} {
  const bundle = createSessionBundleFromDataclawRow(row);
  const normalized = bundle.normalizedEvents.find(
    (snapshot) => snapshot.stepLabel === "tool:result:1:0",
  );
  const event = normalized?.event;
  return {
    ...(event?.type === "task.updated"
      ? { status: event.status, title: event.title, toolFamily: event.toolFamily }
      : {}),
    ...(normalized ? { stepIndex: normalized.stepIndex } : {}),
    bundle,
  };
}

const SAMPLE_OPEN_AGENT_SESSIONS_ROW: OpenAgentSessionsRow = {
  gist_id: "477f0d09356c895de92ea7b187d6f2fe",
  gist_url: "https://gist.github.com/lukaskawerau/477f0d09356c895de92ea7b187d6f2fe",
  jsonl_raw_url: "https://gist.githubusercontent.com/example/session.redacted.jsonl",
  jsonl_file_name: "session.redacted.jsonl",
  metadata_raw_url: "https://gist.githubusercontent.com/example/openagentsessions.json",
  metadata_file_name: "openagentsessions.json",
  contributor: "lukaskawerau",
  session_id: "934689fd-f66b-44aa-a945-28b47d1a6cb9",
  metadata: {
    schema_version: "1",
    license: "CC0-1.0",
    created_at: "2026-02-20T18:45:40.213Z",
    session: {
      agent: "pi",
      model: "gpt-5.3-codex",
      language: "en",
      topic: "Build a redaction extension",
    },
    tags: ["privacy", "extension"],
  },
  raw_mirror_dir: "/tmp/aperture-open-agent-sessions/477f0d09356c895de92ea7b187d6f2fe",
  events: [
    {
      type: "session",
      id: "934689fd-f66b-44aa-a945-28b47d1a6cb9",
      timestamp: "2026-02-20T18:45:40.213Z",
    },
    {
      type: "message",
      id: "user-1",
      timestamp: "2026-02-20T18:46:30.463Z",
      message: {
        role: "user",
        timestamp: 1771613190457,
        content: [
          {
            type: "text",
            text: "Let's make an extension that redacts out personal identifying information and shares the session as a public gist.",
          },
        ],
      },
    },
    {
      type: "message",
      id: "assistant-1",
      timestamp: "2026-02-20T18:46:37.141Z",
      message: {
        role: "assistant",
        timestamp: 1771613197141,
        content: [
          {
            type: "thinking",
            thinking: "**Preparing extension plan**",
          },
          {
            type: "text",
            text: "I'll inspect the extension docs and current repo layout first.",
          },
          {
            type: "toolCall",
            id: "call-1",
            name: "bash",
            arguments: {
              command: "pwd && ls -la",
            },
          },
        ],
      },
    },
    {
      type: "message",
      id: "tool-1",
      timestamp: "2026-02-20T18:46:37.145Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "bash",
        isError: false,
        timestamp: 1771613197145,
        content: [
          {
            type: "text",
            text: "/home/[REDACTED_USER]/coding/apps\nagent-scripts\nopensesh\n",
          },
        ],
      },
    },
    {
      type: "message",
      id: "assistant-2",
      timestamp: "2026-02-20T18:47:22.108Z",
      message: {
        role: "assistant",
        timestamp: 1771613232701,
        content: [
          {
            type: "text",
            text: "I found the extension hooks and the docs we need. Next I'll scaffold the redaction flow.",
          },
        ],
      },
    },
    {
      type: "message",
      id: "user-2",
      timestamp: "2026-02-20T18:48:12.108Z",
      message: {
        role: "user",
        timestamp: 1771613292108,
        content: [
          {
            type: "text",
            text: "Please make sure it strips emails and usernames too.",
          },
        ],
      },
    },
  ],
};

const SAMPLE_TRACE_COMMONS_ROW: TraceCommonsRow = {
  harness: "claude_code",
  session_id: "07b57159-218e-4330-a64e-0ec4b4355056",
  prompt: "Add retry logic to the client and explain the fix.",
  sent_at: "2026-06-12T00:40:34.865Z",
  num_user_messages: 2,
  num_tool_calls: 2,
  file_path: "sessions/claude_code/session.jsonl",
  metadata: {
    source_file: "sessions_claude_code_07b57159-218e-4330-a64e-0ec4b4355056.jsonl",
  },
  tools: [
    {
      type: "function",
      function: {
        name: "Bash",
        description: "Run a shell command.",
      },
    },
    {
      type: "function",
      function: {
        name: "Edit",
        description: "Edit a file.",
      },
    },
  ],
  trace: [
    {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: "2026-06-12T00:40:34.790Z",
    },
  ],
  messages: [
    {
      role: "user",
      content: "Add retry logic to src/client.ts and explain the fix.",
      timestamp: "2026-06-12T00:40:34.865Z",
      id: "user-1",
    },
    {
      role: "assistant",
      content: "I'll inspect the client implementation first.",
      timestamp: "2026-06-12T00:40:36.000Z",
      id: "assistant-1",
      tool_calls: [
        {
          id: "call-bash-1",
          type: "function",
          function: {
            name: "Bash",
            arguments: "{\"command\":\"sed -n '1,120p' src/client.ts\"}",
          },
        },
      ],
    },
    {
      role: "tool",
      name: "Bash",
      tool_call_id: "call-bash-1",
      content: "export async function request() {\n  return fetch('/api');\n}",
      timestamp: "2026-06-12T00:40:37.000Z",
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I found the unguarded request path. Next I'll patch it.",
        },
        {
          type: "toolCall",
          id: "call-edit-1",
          name: "Edit",
          arguments: {
            path: "src/client.ts",
            description: "Add bounded retry logic.",
          },
        },
      ],
      timestamp: "2026-06-12T00:41:00.000Z",
      id: "assistant-2",
    },
    {
      role: "tool",
      name: "Edit",
      tool_call_id: "call-edit-1",
      content: "Patch applied successfully.",
      timestamp: "2026-06-12T00:41:02.000Z",
    },
    {
      role: "user",
      content: "Can you also add a regression test?",
      timestamp: "2026-06-12T00:41:30.000Z",
      id: "user-2",
    },
  ],
};

test("SWE-smith rows parse from dataset-style rows payloads", () => {
  const rows = parseSweSmithRowsResponse({
    rows: [
      { row: SAMPLE_ROW },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.traj_id, SAMPLE_ROW.traj_id);
});

test("DataClaw rows parse from dataset-style rows payloads", () => {
  const rows = parseDataclawRowsResponse({
    rows: [
      { row: SAMPLE_DATACLAW_ROW },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.session_id, SAMPLE_DATACLAW_ROW.session_id);
  assert.equal(rows[0]?.messages[3]?.tool_uses?.[0]?.tool, "Read");
});

test("Trace Commons rows parse from dataset-style rows payloads", () => {
  const rows = parseTraceCommonsRowsResponse({
    rows: [
      { row: SAMPLE_TRACE_COMMONS_ROW },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.session_id, SAMPLE_TRACE_COMMONS_ROW.session_id);
  assert.equal(rows[0]?.messages[1]?.tool_calls?.[0]?.function?.name, "Bash");
});

test("Trace Commons rows parse live-shaped null identity rows with deterministic fallbacks", () => {
  const rows = parseTraceCommonsRowsResponse({
    rows: [
      { row: SAMPLE_TRACE_COMMONS_ROW },
      {
        row_idx: 28,
        row: {
          harness: null,
          session_id: null,
          prompt: null,
          sent_at: null,
          metadata: {
            source_file: "sessions_cursor_debaa898-grafana-loki-monitoring.jsonl",
            session_id: "sessions_cursor_debaa898-grafana-loki-monitoring",
            trace_type: "hermes",
          },
          file_path: "/var/folders/tmp/tc-sessions/sessions_cursor_debaa898-grafana-loki-monitoring.jsonl",
          messages: [
            { role: "assistant", content: "" },
          ],
          tools: [],
          trace: [
            {
              role: "user",
              message: {
                content: [
                  {
                    type: "text",
                    text: "Which Loki logs show document API usage by route?",
                  },
                ],
              },
            },
          ],
        },
      },
      {
        row_idx: 29,
        row: {
          harness: null,
          session_id: null,
          prompt: null,
          sent_at: null,
          metadata: {
            source_file: "sessions_opencode_ses_129b55f7effeSKRtimLg9wxpXa.json",
            trace_type: "structured",
          },
          file_path: "/var/folders/tmp/tc-sessions/sessions_opencode_ses_129b55f7effeSKRtimLg9wxpXa.json",
          messages: [],
          tools: [],
          trace: [
            {
              info: {
                id: "ses_129b55f7effeSKRtimLg9wxpXa",
                model: {
                  providerID: "opencode",
                },
                time: {
                  created: 1781711675521,
                },
              },
              messages: [
                {
                  info: {
                    role: "user",
                    id: "msg-user",
                    time: {
                      created: 1781711675583,
                    },
                  },
                  parts: [
                    {
                      type: "text",
                      text: "Look up whether kernel-level anticheat is lazy or necessary.",
                    },
                  ],
                },
                {
                  info: {
                    role: "assistant",
                    id: "msg-assistant",
                    time: {
                      created: 1781711675673,
                    },
                  },
                  parts: [
                    {
                      type: "text",
                      text: "I'll search current sources and compare claims.",
                    },
                    {
                      type: "tool",
                      tool: "websearch",
                      callID: "call-search",
                      state: {
                        status: "completed",
                        input: {
                          query: "kernel level anticheat necessary security",
                        },
                        output: "Search results with multiple sources.",
                      },
                      time: {
                        end: 1781711681428,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  });

  assert.equal(rows.length, 3);
  assert.equal(rows[1]?.harness, "cursor");
  assert.equal(rows[1]?.session_id, "sessions_cursor_debaa898-grafana-loki-monitoring");
  assert.equal(rows[1]?.messages[0]?.role, "user");
  assert.match(rows[1]?.prompt ?? "", /Loki logs/);
  assert.equal(rows[2]?.harness, "opencode");
  assert.equal(rows[2]?.session_id, "ses_129b55f7effeSKRtimLg9wxpXa");
  assert.equal(rows[2]?.messages.some((message) => message.role === "tool"), true);
});

test("SWE-smith message helpers preserve transcript text", () => {
  const messages = parseSweSmithMessages(SAMPLE_ROW);

  assert.equal(messages.length, 7);
  assert.equal(
    extractSweSmithMessageText(messages[1]!),
    "We're currently solving the following issue within our repository. ISSUE:\nMoneyWidget crashes on invalid provider responses\nTraceback shows string indices must be integers.",
  );
  assert.equal(
    extractSweSmithMessageText(messages[3]!),
    "Traceback (most recent call last): TypeError: string indices must be integers",
  );
});

test("SWE-smith rows first map into canonical imported sessions", () => {
  const session = createImportedSessionFromSweSmithTrajectory(SAMPLE_ROW);

  assert.equal(session.sessionId, "public:swe-smith:example-repo-123-run-42");
  assert.equal(session.entries.length, 7);
  assert.equal(session.entries[0]?.role, "system");
  assert.equal(session.entries[0]?.significance, "context");
  assert.equal(session.entries[1]?.role, "user");
  assert.equal(session.entries[1]?.significance, "attention");
  assert.equal(session.entries[1]?.sourceEvent?.type, "task.started");
  assert.equal(session.entries[2]?.kind, "tool_call");
  assert.equal(session.entries[2]?.sourceEvent?.type, "task.updated");
  assert.equal(session.entries[3]?.kind, "tool_result");
  assert.equal(session.entries[3]?.sourceEvent?.type, "task.updated");
  assert.equal(session.entries.at(-1)?.kind, "completion");
  assert.equal(session.entries.at(-1)?.sourceEvent?.type, "task.completed");
});

test("SWE-smith rows map into replay scenarios with started, update, failure, and completion steps", () => {
  const scenario = createScenarioFromSweSmithRow(SAMPLE_ROW);

  assert.equal(scenario.steps.length, 6);
  assert.equal(scenario.steps[0]?.kind, "publishSource");
  assert.equal(scenario.steps[0]?.event.type, "task.started");
  assert.equal(scenario.steps[0]?.event.title, "MoneyWidget crashes on invalid provider responses");

  const bashAction = scenario.steps[1];
  assert.equal(bashAction?.kind, "publishSource");
  assert.equal(bashAction?.event.type, "task.updated");
  assert.equal(bashAction?.event.status, "running");
  assert.equal(bashAction?.event.toolFamily, "bash");

  const failedObservation = scenario.steps[2];
  assert.equal(failedObservation?.kind, "publishSource");
  assert.equal(failedObservation?.event.type, "task.updated");
  assert.equal(failedObservation?.event.status, "failed");
  assert.equal(failedObservation?.event.toolFamily, "bash");

  const completed = scenario.steps.at(-1);
  assert.equal(completed?.kind, "publishSource");
  assert.equal(completed?.event.type, "task.completed");
});

test("SWE-smith rows can become replayable session bundles", () => {
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const replayed = runSessionBundle(bundle);

  assert.equal(bundle.steps.length, 6);
  assert.equal(bundle.normalizedEvents.length, 6);
  assert.equal(bundle.semanticSnapshots.length, 6);
  assert.equal(bundle.decisionSnapshots.length, 6);
  assert.equal(bundle.source?.id, "huggingface:swe-smith");
  assert.ok(bundle.source?.capture?.notes?.includes("split=tool"));
  assert.equal(replayed.views.at(-1)?.nowInteractionId, bundle.outcomes.finalNowInteractionId);
  assert.equal(replayed.views.at(-1)?.nextInteractionIds.length, bundle.outcomes.finalNextCount);
  assert.equal(replayed.views.at(-1)?.ambientInteractionIds.length, bundle.outcomes.finalAmbientCount);
});

test("SWE-smith imported bundle paths stay under the dataset and split tree", () => {
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const filePath = defaultImportedTrajectoryBundlePath(bundle, "swe-smith", "tool", "/tmp/aperture-imports");

  assert.match(filePath, /\/tmp\/aperture-imports\/swe-smith\/tool\/public-swe-smith-example-repo-123-run-42\.json$/);
});

test("DataClaw rows first map into canonical imported sessions", () => {
  const session = createImportedSessionFromDataclawRow(SAMPLE_DATACLAW_ROW);
  const finalEvent = session.entries.at(-1)?.sourceEvent;

  assert.equal(session.sessionId, "public:dataclaw:123e4567-e89b-12d3-a456-426614174000");
  assert.equal(session.entries[0]?.significance, "context");
  assert.equal(session.entries[1]?.sourceEvent?.type, "task.started");
  assert.equal(session.entries[2]?.sourceEvent?.type, "task.updated");
  assert.equal(session.entries[3]?.kind, "tool_call");
  assert.equal(session.entries[4]?.kind, "tool_result");
  assert.equal(session.entries[4]?.toolFamily, "read");
  assert.equal(finalEvent?.type, "task.updated");
  assert.equal(finalEvent?.title, "user follow-up");
});

test("public trajectory source summaries preserve valid structured output", () => {
  const summary = JSON.stringify({
    exit_code: 0,
    wall_time: "0.0500 seconds",
    output: `#include <stdio.h>\n${"int value = 1;\n".repeat(900)}`,
  });
  const clipped = clipSourceEventSummary(summary);
  const parsed = JSON.parse(clipped) as {
    exit_code: number;
    truncated: boolean;
    wall_time: string;
    output: string;
  };

  assert.ok(clipped.length <= 8192);
  assert.equal(parsed.exit_code, 0);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.wall_time, "0.0500 seconds");
  assert.match(parsed.output, /^#include <stdio\.h>/);
  assert.match(parsed.output, /\.\.\.$/);
});

test("DataClaw source-event summaries keep structured tool output parseable", () => {
  const longOutput = `#include <stdio.h>\n${"int value = 1;\n".repeat(900)}`;
  const row = createDataclawToolStatusRow({
    sessionId: "423e4567-e89b-12d3-a456-426614174000",
    tool: "Bash",
    output: {
      exit_code: 0,
      wall_time: "0.0500 seconds",
      output: longOutput,
    },
    status: "failed",
  });
  const session = createImportedSessionFromDataclawRow(row);
  const toolResult = session.entries.find((entry) => entry.label === "tool:result:1:0");
  const summary =
    toolResult?.sourceEvent?.type === "task.updated" ? toolResult.sourceEvent.summary : undefined;
  const parsed = JSON.parse(summary ?? "") as {
    exit_code: number;
    truncated: boolean;
    wall_time: string;
    output: string;
  };

  assert.ok((toolResult?.excerpt?.length ?? 0) <= 240);
  assert.ok((summary?.length ?? 0) > 240);
  assert.ok((summary?.length ?? 0) <= 8192);
  assert.equal(parsed.exit_code, 0);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.wall_time, "0.0500 seconds");
  assert.match(parsed.output, /^#include <stdio\.h>/);
  assert.match(parsed.output, /\.\.\.$/);
});

test("DataClaw rows map into replay scenarios with user, tool, and follow-up steps", () => {
  const scenario = createReplayScenarioFromDataclawRow(SAMPLE_DATACLAW_ROW);
  const firstStep = scenario.steps[0];
  const secondStep = scenario.steps[1];
  const thirdStep = scenario.steps[2];
  const fourthStep = scenario.steps[3];
  const finalStep = scenario.steps.at(-1);

  assert.equal(firstStep?.kind, "publishSource");
  assert.equal(firstStep?.event.type, "task.started");
  assert.equal(secondStep?.kind, "publishSource");
  assert.equal(secondStep?.event.type, "task.updated");
  assert.equal(thirdStep?.kind, "publishSource");
  assert.equal(thirdStep?.event.type, "task.updated");
  assert.equal(thirdStep?.event.toolFamily, "read");
  assert.equal(fourthStep?.kind, "publishSource");
  assert.equal(fourthStep?.event.type, "task.updated");
  assert.equal(fourthStep?.event.toolFamily, "read");
  assert.equal(finalStep?.kind, "publishSource");
  assert.equal(finalStep?.event.type, "task.updated");
  assert.equal(finalStep?.event.title, "user follow-up");
});

test("DataClaw rows can become replayable session bundles", () => {
  const bundle = createSessionBundleFromDataclawRow(SAMPLE_DATACLAW_ROW);
  const replayed = runSessionBundle(bundle);

  assert.equal(bundle.source?.id, "huggingface:dataclaw");
  assert.ok(bundle.source?.capture?.notes?.includes("project=demo-project"));
  assert.equal(replayed.views.at(-1)?.nowInteractionId, bundle.outcomes.finalNowInteractionId);
  assert.equal(replayed.views.at(-1)?.nextInteractionIds.length, bundle.outcomes.finalNextCount);
  assert.equal(replayed.views.at(-1)?.ambientInteractionIds.length, bundle.outcomes.finalAmbientCount);
});

test("DataClaw Glob calls normalize to search through import, replay, and semantic capture", () => {
  const session = createImportedSessionFromDataclawRow(SAMPLE_DATACLAW_GLOB_ROW);
  const toolCallEntry = session.entries.find((entry) => entry.kind === "tool_call");
  const toolResultEntry = session.entries.find((entry) => entry.kind === "tool_result");

  assert.equal(toolCallEntry?.toolName, "Glob");
  assert.equal(toolCallEntry?.toolFamily, "search");
  assert.equal(toolResultEntry?.toolFamily, "search");
  assert.equal(toolCallEntry?.sourceEvent?.type, "task.updated");
  assert.equal(
    toolCallEntry?.sourceEvent?.type === "task.updated"
      ? toolCallEntry.sourceEvent.toolFamily
      : undefined,
    "search",
  );
  assert.equal(toolResultEntry?.sourceEvent?.type, "task.updated");
  assert.equal(
    toolResultEntry?.sourceEvent?.type === "task.updated"
      ? toolResultEntry.sourceEvent.toolFamily
      : undefined,
    "search",
  );

  const scenario = createReplayScenarioFromDataclawRow(SAMPLE_DATACLAW_GLOB_ROW);
  const searchSteps = scenario.steps.filter(
    (step) =>
      step.kind === "publishSource" &&
      step.event.type === "task.updated" &&
      step.event.toolFamily === "search",
  );
  assert.equal(searchSteps.length, 2);

  const bundle = createSessionBundleFromDataclawRow(SAMPLE_DATACLAW_GLOB_ROW);
  const replayed = runSessionBundle(bundle);
  assert.equal(
    bundle.normalizedEvents.some(
      (snapshot) =>
        snapshot.event.type === "task.updated" && snapshot.event.toolFamily === "search",
    ),
    true,
  );
  assert.equal(
    bundle.semanticSnapshots.some(
      (snapshot) => snapshot.interpretation.toolFamily === "search",
    ),
    true,
  );
  assert.equal(
    replayed.semantics.some((snapshot) => snapshot.interpretation.toolFamily === "search"),
    true,
  );
});

test("DataClaw failed Read status with line-numbered output imports as running readback", () => {
  const row = createDataclawToolStatusRow({
    sessionId: "323e4567-e89b-12d3-a456-426614174000",
    output: {
      text: "1→export async function request() {\n2→  return fetch('/api');\n3→}",
    },
    status: "failed",
  });
  const scenario = createReplayScenarioFromDataclawRow(row);
  const readResultStep = scenario.steps.find(
    (step) => step.kind === "publishSource" && step.label === "tool:result:1:0",
  );

  assert.equal(readResultStep?.kind, "publishSource");
  assert.equal(
    readResultStep?.kind === "publishSource" && readResultStep.event.type === "task.updated"
      ? readResultStep.event.status
      : undefined,
    "running",
  );
  assert.equal(
    readResultStep?.kind === "publishSource" && readResultStep.event.type === "task.updated"
      ? readResultStep.event.title
      : undefined,
    "read observation",
  );

  const bundle = createSessionBundleFromDataclawRow(row);
  const readResult = bundle.normalizedEvents.find(
    (snapshot) =>
      snapshot.event.type === "task.updated" &&
      snapshot.event.summary?.includes("export async function request"),
  );
  const semantic = bundle.semanticSnapshots.find(
    (snapshot) => snapshot.stepIndex === readResult?.stepIndex,
  );
  const decision = bundle.decisionSnapshots.find(
    (snapshot) => snapshot.stepIndex === readResult?.stepIndex,
  );
  assert.equal(readResult?.event.type, "task.updated");
  assert.equal(
    readResult?.event.type === "task.updated" ? readResult.event.status : undefined,
    "running",
  );
  assert.notEqual(semantic?.interpretation.intentFrame, "failure");
  assert.notEqual(semantic?.interpretation.activityClass, "tool_failure");
  assert.notEqual(semantic?.interpretation.consequence, "high");
  assert.notEqual(decision?.resultLane, "now");
});

test("DataClaw observational status conflicts require affirmative success evidence", () => {
  const cases = [
    {
      name: "error Read with line-numbered output",
      tool: "Read",
      status: "error",
      output: { text: "1→export const ok = true;\n2→" },
      expectedStatus: "running",
      expectedTitle: "read observation",
      expectedToolFamily: "read",
    },
    {
      name: "Read with no status and error-like file content",
      tool: "Read",
      status: undefined,
      output: { text: "1→export function failFast() {\n2→  throw new Error('bad');\n3→}" },
      expectedStatus: "running",
      expectedTitle: "read observation",
      expectedToolFamily: "read",
    },
    {
      name: "failed Read with structured files content",
      tool: "Read",
      status: "failed",
      output: {
        files: [
          {
            path: "/workspace/src/client.ts",
            content: "export async function request() {\n  return fetch('/api');\n}",
          },
        ],
      },
      expectedStatus: "running",
      expectedTitle: "read observation",
      expectedToolFamily: "read",
    },
    {
      name: "failed Read with plain source content",
      tool: "Read",
      status: "failed",
      output: {
        text: '#ifndef GRAMMAR_H\n#define GRAMMAR_H\n#include <memory>\nclass Parser { const char* error = "symbol not found"; };',
      },
      expectedStatus: "running",
      expectedTitle: "read observation",
      expectedToolFamily: "read",
    },
    {
      name: "failed Read with explicit ENOENT error",
      tool: "Read",
      status: "failed",
      output: { error: "ENOENT: no such file or directory, open '/workspace/src/client.ts'" },
      expectedStatus: "failed",
      expectedTitle: "read failure",
      expectedToolFamily: "read",
    },
    {
      name: "failed Read with plain ENOENT text",
      tool: "Read",
      status: "failed",
      output: { text: "ENOENT: no such file or directory, open '/workspace/src/client.ts'" },
      expectedStatus: "failed",
      expectedTitle: "read failure",
      expectedToolFamily: "read",
    },
    {
      name: "failed Read with mixed content and error",
      tool: "Read",
      status: "failed",
      output: {
        text: "1→export const partial = true;",
        error: "Read was interrupted before completion.",
      },
      expectedStatus: "failed",
      expectedTitle: "read failure",
      expectedToolFamily: "read",
    },
    {
      name: "cancelled Read with partial content",
      tool: "Read",
      status: "cancelled",
      output: { text: "1→export const partial = true;" },
      expectedStatus: "failed",
      expectedTitle: "read failure",
      expectedToolFamily: "read",
    },
    {
      name: "rejected Read with partial content",
      tool: "Read",
      status: "rejected",
      output: { text: "1→export const partial = true;" },
      expectedStatus: "failed",
      expectedTitle: "read failure",
      expectedToolFamily: "read",
    },
    {
      name: "failed Bash with line-numbered output",
      tool: "Bash",
      status: "failed",
      output: { text: "1→export const partial = true;" },
      expectedStatus: "failed",
      expectedTitle: "bash failure",
      expectedToolFamily: "bash",
    },
    {
      name: "failed Edit with line-numbered output",
      tool: "Edit",
      status: "failed",
      output: { text: "1→export const partial = true;" },
      expectedStatus: "failed",
      expectedTitle: "edit failure",
      expectedToolFamily: "edit",
    },
    {
      name: "failed Glob with structured files",
      tool: "Glob",
      input: { pattern: "**/*.ts" },
      status: "failed",
      output: { files: ["src/client.ts"] },
      expectedStatus: "running",
      expectedTitle: "search observation",
      expectedToolFamily: "search",
    },
    {
      name: "failed Search with explicit error",
      tool: "Search",
      input: { query: "request" },
      status: "failed",
      output: { error: "search index unavailable" },
      expectedStatus: "failed",
      expectedTitle: "search failure",
      expectedToolFamily: "search",
    },
    {
      name: "failed Read without output",
      tool: "Read",
      status: "failed",
      output: undefined,
      expectedStatus: "failed",
      expectedTitle: "read failure",
      expectedToolFamily: "read",
    },
  ] as const;

  for (const [index, entry] of cases.entries()) {
    const result = readDataclawSingleToolResult(
      createDataclawToolStatusRow({
        sessionId: `${500 + index}e4567-e89b-12d3-a456-426614174000`,
        tool: entry.tool,
        ...("input" in entry ? { input: entry.input } : {}),
        output: entry.output,
        status: entry.status,
      }),
    );

    assert.equal(result.status, entry.expectedStatus, entry.name);
    assert.equal(result.title, entry.expectedTitle, entry.name);
    assert.equal(result.toolFamily, entry.expectedToolFamily, entry.name);
  }
});

test("DataClaw imported bundle paths stay under the dataset and split tree", () => {
  const bundle = createSessionBundleFromDataclawRow(SAMPLE_DATACLAW_ROW);
  const filePath = defaultImportedTrajectoryBundlePath(bundle, "dataclaw", "train", "/tmp/aperture-imports");

  assert.match(
    filePath,
    /\/tmp\/aperture-imports\/dataclaw\/train\/public-dataclaw-123e4567-e89b-12d3-a456-426614174000\.json$/,
  );
});

test("OpenAgentSessions rows first map into canonical imported sessions", () => {
  const session = createImportedSessionFromOpenAgentSessionsRow(SAMPLE_OPEN_AGENT_SESSIONS_ROW);
  const finalEvent = session.entries.at(-1)?.sourceEvent;

  assert.equal(session.sessionId, "public:open-agent-sessions:934689fd-f66b-44aa-a945-28b47d1a6cb9");
  assert.match(session.title, /^Let's make an extension that redacts out personal identifying information and shares the sess\.\.\.$/);
  assert.equal(session.source?.id, "open-agent-sessions:approved");
  assert.equal(session.source?.license, "CC0-1.0");
  assert.equal(session.entries[0]?.sourceEvent?.type, "task.started");
  assert.equal(session.entries[1]?.sourceEvent?.type, "task.updated");
  assert.equal(session.entries[2]?.kind, "tool_call");
  assert.equal(session.entries[3]?.kind, "tool_result");
  assert.equal(session.entries[3]?.toolFamily, "bash");
  assert.equal(finalEvent?.type, "task.updated");
  assert.equal(finalEvent?.type === "task.updated" ? finalEvent.title : undefined, "user follow-up");
});

test("OpenAgentSessions rows map into replay scenarios with user, tool, and follow-up steps", () => {
  const scenario = createReplayScenarioFromOpenAgentSessionsRow(SAMPLE_OPEN_AGENT_SESSIONS_ROW);
  const firstStep = scenario.steps[0];
  const secondStep = scenario.steps[1];
  const thirdStep = scenario.steps[2];
  const fourthStep = scenario.steps[3];
  const finalStep = scenario.steps.at(-1);

  assert.equal(firstStep?.kind, "publishSource");
  assert.equal(firstStep?.kind === "publishSource" ? firstStep.event.type : undefined, "task.started");
  assert.equal(secondStep?.kind === "publishSource" ? secondStep.event.type : undefined, "task.updated");
  assert.equal(thirdStep?.kind === "publishSource" ? thirdStep.event.type : undefined, "task.updated");
  assert.equal(
    thirdStep?.kind === "publishSource" && thirdStep.event.type === "task.updated"
      ? thirdStep.event.toolFamily
      : undefined,
    "bash",
  );
  assert.equal(fourthStep?.kind === "publishSource" ? fourthStep.event.type : undefined, "task.updated");
  assert.equal(
    fourthStep?.kind === "publishSource" && fourthStep.event.type === "task.updated"
      ? fourthStep.event.toolFamily
      : undefined,
    "bash",
  );
  assert.equal(
    finalStep?.kind === "publishSource" && finalStep.event.type === "task.updated"
      ? finalStep.event.title
      : undefined,
    "user follow-up",
  );
});

test("OpenAgentSessions rows can become replayable session bundles", () => {
  const bundle = createSessionBundleFromOpenAgentSessionsRow(SAMPLE_OPEN_AGENT_SESSIONS_ROW);
  const replayed = runSessionBundle(bundle);

  assert.equal(bundle.source?.id, "open-agent-sessions:approved");
  assert.ok(bundle.source?.capture?.notes?.includes("dataset=open-agent-sessions"));
  assert.equal(replayed.views.at(-1)?.nowInteractionId, bundle.outcomes.finalNowInteractionId);
  assert.equal(replayed.views.at(-1)?.nextInteractionIds.length, bundle.outcomes.finalNextCount);
  assert.equal(replayed.views.at(-1)?.ambientInteractionIds.length, bundle.outcomes.finalAmbientCount);
});

test("OpenAgentSessions imported bundle paths stay under the dataset and split tree", () => {
  const bundle = createSessionBundleFromOpenAgentSessionsRow(SAMPLE_OPEN_AGENT_SESSIONS_ROW);
  const filePath = defaultImportedTrajectoryBundlePath(bundle, "open-agent-sessions", "approved", "/tmp/aperture-imports");

  assert.match(
    filePath,
    /\/tmp\/aperture-imports\/open-agent-sessions\/approved\/public-open-agent-sessions-934689fd-f66b-44aa-a945-28b47d1a6cb9\.json$/,
  );
});

test("Trace Commons rows first map into canonical imported sessions", () => {
  const session = createImportedSessionFromTraceCommonsRow(SAMPLE_TRACE_COMMONS_ROW);
  const finalEvent = session.entries.at(-1)?.sourceEvent;

  assert.equal(session.sessionId, "public:trace-commons:claude_code:07b57159-218e-4330-a64e-0ec4b4355056");
  assert.equal(session.source?.id, "huggingface:trace-commons-agent-traces");
  assert.equal(session.source?.redacted, true);
  assert.equal(session.entries[0]?.kind, "boundary");
  assert.equal(session.entries[1]?.sourceEvent?.type, "task.started");
  assert.equal(session.entries[3]?.kind, "tool_call");
  assert.equal(session.entries[3]?.toolFamily, "bash");
  assert.equal(session.entries[4]?.kind, "tool_result");
  assert.equal(session.entries[4]?.toolFamily, "bash");
  assert.equal(finalEvent?.type, "task.updated");
  assert.equal(finalEvent?.type === "task.updated" ? finalEvent.title : undefined, "user follow-up");
});

test("Trace Commons rows map into replay scenarios with user, assistant, tool, and follow-up steps", () => {
  const scenario = createReplayScenarioFromTraceCommonsRow(SAMPLE_TRACE_COMMONS_ROW);
  const finalStep = scenario.steps.at(-1);

  assert.equal(scenario.steps.length, 8);
  assert.equal(scenario.steps[0]?.kind, "publishSource");
  assert.equal(scenario.steps[0]?.event.type, "task.started");
  assert.equal(scenario.steps[2]?.kind, "publishSource");
  assert.equal(scenario.steps[2]?.event.type, "task.updated");
  assert.equal(scenario.steps[2]?.event.toolFamily, "bash");
  assert.equal(scenario.steps[5]?.kind, "publishSource");
  assert.equal(scenario.steps[5]?.event.type, "task.updated");
  assert.equal(scenario.steps[5]?.event.toolFamily, "edit");
  assert.equal(
    finalStep?.kind === "publishSource" && finalStep.event.type === "task.updated"
      ? finalStep.event.title
      : undefined,
    "user follow-up",
  );
});

test("Trace Commons rows can become replayable session bundles", () => {
  const bundle = createSessionBundleFromTraceCommonsRow(SAMPLE_TRACE_COMMONS_ROW);
  const replayed = runSessionBundle(bundle);

  assert.equal(bundle.source?.id, "huggingface:trace-commons-agent-traces");
  assert.ok(bundle.source?.capture?.notes?.includes("dataset=trace-commons/agent-traces"));
  assert.ok(bundle.source?.capture?.notes?.includes("harness=claude_code"));
  assert.ok(bundle.source?.capture?.notes?.includes("source_identity=sessions_claude_code_07b57159-218e-4330-a64e-0ec4b4355056.jsonl"));
  assert.ok(bundle.source?.capture?.notes?.includes("privacy=public_anonymized_best_effort_review_required"));
  assert.ok(bundle.source?.capture?.notes?.includes("license_scope=dataset_compilation_cc_by_4.0_embedded_content_may_differ"));
  assert.ok(bundle.source?.capture?.notes?.some((note) => note.startsWith("row_digest_sha256=")));
  assert.equal(replayed.views.at(-1)?.nowInteractionId, bundle.outcomes.finalNowInteractionId);
  assert.equal(replayed.views.at(-1)?.nextInteractionIds.length, bundle.outcomes.finalNextCount);
  assert.equal(replayed.views.at(-1)?.ambientInteractionIds.length, bundle.outcomes.finalAmbientCount);
});

test("Trace Commons imported bundle paths stay under the dataset and split tree", () => {
  const bundle = createSessionBundleFromTraceCommonsRow(SAMPLE_TRACE_COMMONS_ROW);
  const filePath = defaultImportedTrajectoryBundlePath(bundle, "trace-commons", "train", "/tmp/aperture-imports");

  assert.match(
    filePath,
    /\/tmp\/aperture-imports\/trace-commons\/train\/public-trace-commons-claude_code-07b57159-218e-4330-a64e-0ec4b4355056\.json$/,
  );
});

test("Trace Commons replay timestamps stay monotonic when messages omit timestamps", () => {
  const row: TraceCommonsRow = {
    ...SAMPLE_TRACE_COMMONS_ROW,
    session_id: "trace-no-message-timestamps",
    messages: SAMPLE_TRACE_COMMONS_ROW.messages.map(({ timestamp: _timestamp, ...message }) => message),
  };
  const scenario = createReplayScenarioFromTraceCommonsRow(row);
  const timestamps = scenario.steps.map((step) =>
    step.kind === "publishSource" ? step.event.timestamp : "");
  const uniqueTimestamps = new Set(timestamps);

  assert.equal(timestamps.length, uniqueTimestamps.size);
  assert.equal(timestamps[0], "2026-06-12T00:40:35.865Z");
  assert.equal(timestamps[1], "2026-06-12T00:40:36.865Z");
});

test("Trace Commons bundle identity is harness-qualified", () => {
  const firstBundle = createSessionBundleFromTraceCommonsRow({
    ...SAMPLE_TRACE_COMMONS_ROW,
    harness: "codex",
    session_id: "shared-session-id",
  });
  const secondBundle = createSessionBundleFromTraceCommonsRow({
    ...SAMPLE_TRACE_COMMONS_ROW,
    harness: "opencode",
    session_id: "shared-session-id",
  });

  assert.notEqual(firstBundle.sessionId, secondBundle.sessionId);
  assert.equal(firstBundle.sessionId, "public:trace-commons:codex:shared-session-id");
  assert.equal(secondBundle.sessionId, "public:trace-commons:opencode:shared-session-id");
});

test("Trace Commons fetch rejects limits beyond the Hugging Face rows cap", async () => {
  await assert.rejects(
    () => fetchTraceCommonsRows({ limit: 101 }),
    /Trace Commons import limit must be <= 100/,
  );
});

test("OpenAgentSessions rows merge homepage-approved gists with the bulk URL feed", async () => {
  const gistIds = [
    "477f0d09356c895de92ea7b187d6f2fe",
    "d370eaf1c66518ef4940dc4f8987eabb",
    "fb698e6ee148c910f22480e85a77c139",
  ] as const;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url === OPEN_AGENT_SESSIONS_URLS_URL) {
      return new Response(`https://gist.github.com/lukaskawerau/${gistIds[0]}\n`, { status: 200 });
    }

    if (url === OPEN_AGENT_SESSIONS_SITE_URL) {
      return new Response(
        [
          `<a href="https://gist.github.com/lukaskawerau/${gistIds[0]}">one</a>`,
          `<a href="https://gist.github.com/lukaskawerau/${gistIds[1]}">two</a>`,
          `<a href="https://gist.github.com/lukaskawerau/${gistIds[2]}">three</a>`,
        ].join("\n"),
        { status: 200 },
      );
    }

    const gistMatch = url.match(/https:\/\/api\.github\.com\/gists\/([a-f0-9]+)/i);
    if (gistMatch?.[1]) {
      const gistId = gistMatch[1];
      return new Response(JSON.stringify({
        owner: { login: "lukaskawerau" },
        files: {
          [`2026-03-28_${gistId}.redacted.jsonl`]: {
            raw_url: `https://example.invalid/${gistId}.jsonl`,
          },
        },
      }), { status: 200 });
    }

    const jsonlMatch = url.match(/https:\/\/example\.invalid\/([a-f0-9]+)\.jsonl/i);
    if (jsonlMatch?.[1]) {
      const gistId = jsonlMatch[1];
      return new Response(`{"type":"session","id":"session-${gistId}"}\n`, { status: 200 });
    }

    throw new Error(`Unexpected fetch URL in test: ${url}`);
  }) as typeof fetch;

  try {
    const rows = await fetchOpenAgentSessionsRows({ limit: 3, dryRun: true });
    assert.deepEqual(rows.map((row) => row.gist_id), gistIds);
    assert.deepEqual(rows.map((row) => row.session_id), gistIds.map((gistId) => `session-${gistId}`));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAgentSessions bashExecution messages import as bash observations", () => {
  const row: OpenAgentSessionsRow = {
    ...SAMPLE_OPEN_AGENT_SESSIONS_ROW,
    session_id: "bfcb85f5-4b9f-40e3-9703-8dcd8b21cf99",
    events: [
      ...SAMPLE_OPEN_AGENT_SESSIONS_ROW.events,
      {
        type: "message",
        id: "bash-exec-1",
        timestamp: "2026-03-28T11:16:11.303Z",
        message: {
          role: "bashExecution",
          command: "gh auth refresh -h github.com -s gist",
          output: "Authentication complete.",
          exitCode: 0,
          cancelled: false,
          truncated: false,
          timestamp: 1774696571303,
        },
      },
    ],
  };

  const scenario = createReplayScenarioFromOpenAgentSessionsRow(row);
  const userFollowupStep = scenario.steps.at(-2);
  const bashStep = scenario.steps.at(-1);

  assert.equal(bashStep?.kind, "publishSource");
  assert.equal(bashStep?.event.type, "task.updated");
  assert.equal(bashStep?.event.toolFamily, "bash");
  assert.equal(bashStep?.event.status, "running");
  assert.equal(bashStep?.event.title, "bash observation");
  assert.match(bashStep?.event.summary ?? "", /gh auth refresh/);
  assert.equal(
    userFollowupStep?.kind === "publishSource" && userFollowupStep.event.type === "task.updated"
      ? userFollowupStep.event.title
      : undefined,
    "user follow-up",
  );
});

test("OpenAgentSessions bundle paths stay unique when session ids are redacted", () => {
  const firstBundle = createSessionBundleFromOpenAgentSessionsRow({
    ...SAMPLE_OPEN_AGENT_SESSIONS_ROW,
    gist_id: "d370eaf1c66518ef4940dc4f8987eabb",
    session_id: "[REDACTED_UUID]",
  });
  const secondBundle = createSessionBundleFromOpenAgentSessionsRow({
    ...SAMPLE_OPEN_AGENT_SESSIONS_ROW,
    gist_id: "fb698e6ee148c910f22480e85a77c139",
    session_id: "[REDACTED_UUID]",
  });

  const firstPath = defaultImportedTrajectoryBundlePath(firstBundle, "open-agent-sessions", "approved", "/tmp/aperture-imports");
  const secondPath = defaultImportedTrajectoryBundlePath(secondBundle, "open-agent-sessions", "approved", "/tmp/aperture-imports");

  assert.notEqual(firstBundle.sessionId, secondBundle.sessionId);
  assert.notEqual(firstPath, secondPath);
  assert.match(firstPath, /d370eaf1c66518ef4940dc4f8987eabb/);
  assert.match(secondPath, /fb698e6ee148c910f22480e85a77c139/);
});

test("successful edit observations with error-looking filenames stay running", () => {
  const row: SweSmithRow = {
    ...SAMPLE_ROW,
    traj_id: "example/repo-123.run-successful-edit",
    messages: JSON.stringify([
      {
        role: "user",
        content: [{ type: "text", text: "ISSUE:\nCreate the repro script and verify it." }],
        agent: "main",
        message_type: "observation",
      },
      {
        role: "assistant",
        content: "I will create the repro file.",
        action: "edit /testbed/reproduce_error.py",
        agent: "main",
        tool_calls: [
          {
            function: {
              name: "edit",
              arguments: "{\"path\":\"/testbed/reproduce_error.py\"}",
            },
          },
        ],
        message_type: "action",
      },
      {
        role: "tool",
        content: [{ type: "text", text: "OBSERVATION: File created successfully at: /testbed/reproduce_error.py" }],
        agent: "main",
        message_type: "observation",
      },
      {
        role: "tool",
        content: [{ type: "text", text: "OBSERVATION: The file /testbed/reproduce_error.py has been edited." }],
        agent: "main",
        message_type: "observation",
      },
    ]),
  };

  const scenario = createScenarioFromSweSmithRow(row);
  const firstObservation = scenario.steps[2];
  const secondObservation = scenario.steps[3];

  assert.equal(firstObservation?.kind, "publishSource");
  assert.equal(firstObservation?.event.type, "task.updated");
  assert.equal(firstObservation?.event.status, "running");
  assert.equal(firstObservation?.event.title, "edit observation");

  assert.equal(secondObservation?.kind, "publishSource");
  assert.equal(secondObservation?.event.type, "task.updated");
  assert.equal(secondObservation?.event.status, "running");
  assert.equal(secondObservation?.event.title, "edit observation");
});

test("readback and truncation observations stay running instead of failed", () => {
  const row: SweSmithRow = {
    ...SAMPLE_ROW,
    traj_id: "example/repo-123.run-readback",
    messages: JSON.stringify([
      {
        role: "user",
        content: [{ type: "text", text: "ISSUE:\nInspect the large source file." }],
        agent: "main",
        message_type: "observation",
      },
      {
        role: "assistant",
        content: "I'll inspect the file.",
        action: "edit /testbed/src/apispec/core.py",
        agent: "main",
        tool_calls: [
          {
            function: {
              name: "edit",
              arguments: "{\"path\":\"/testbed/src/apispec/core.py\"}",
            },
          },
        ],
        message_type: "action",
      },
      {
        role: "tool",
        content: [{ type: "text", text: "OBSERVATION: Here's the result of running `cat -n` on /testbed/src/apispec/core.py: 492 def path(...)" }],
        agent: "main",
        message_type: "observation",
      },
      {
        role: "tool",
        content: [{ type: "text", text: "OBSERVATION: This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next." }],
        agent: "main",
        message_type: "observation",
      },
    ]),
  };

  const scenario = createScenarioFromSweSmithRow(row);
  const readback = scenario.steps[2];
  const truncation = scenario.steps[3];

  assert.equal(readback?.kind, "publishSource");
  assert.equal(readback?.event.type, "task.updated");
  assert.equal(readback?.event.status, "running");

  assert.equal(truncation?.kind, "publishSource");
  assert.equal(truncation?.event.type, "task.updated");
  assert.equal(truncation?.event.status, "running");
});

test("true traceback observations still import as failed", () => {
  const row: SweSmithRow = {
    ...SAMPLE_ROW,
    traj_id: "example/repo-123.run-traceback",
    messages: JSON.stringify([
      {
        role: "user",
        content: [{ type: "text", text: "ISSUE:\nReproduce the bug." }],
        agent: "main",
        message_type: "observation",
      },
      {
        role: "assistant",
        content: "I'll run the repro.",
        action: "bash python /testbed/repro.py",
        agent: "main",
        tool_calls: [
          {
            function: {
              name: "bash",
              arguments: "{\"command\":\"python /testbed/repro.py\"}",
            },
          },
        ],
        message_type: "action",
      },
      {
        role: "tool",
        content: [{ type: "text", text: "Traceback (most recent call last): ValueError: broken input" }],
        agent: "main",
        message_type: "observation",
      },
    ]),
  };

  const scenario = createScenarioFromSweSmithRow(row);
  const failureObservation = scenario.steps[2];

  assert.equal(failureObservation?.kind, "publishSource");
  assert.equal(failureObservation?.event.type, "task.updated");
  assert.equal(failureObservation?.event.status, "failed");
  assert.equal(failureObservation?.event.title, "bash failure");
});
