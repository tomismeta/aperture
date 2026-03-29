import assert from "node:assert/strict";
import test from "node:test";

import {
  createImportedSessionFromDataclawRow,
  createImportedSessionFromOpenAgentSessionsRow,
  createReplayScenarioFromDataclawRow,
  createReplayScenarioFromOpenAgentSessionsRow,
  createSessionBundleFromDataclawRow,
  createSessionBundleFromOpenAgentSessionsRow,
  createImportedSessionFromSweSmithTrajectory,
  defaultImportedTrajectoryBundlePath,
  createScenarioFromSweSmithRow,
  createSessionBundleFromSweSmithRow,
  extractSweSmithMessageText,
  fetchOpenAgentSessionsRows,
  OPEN_AGENT_SESSIONS_SITE_URL,
  OPEN_AGENT_SESSIONS_URLS_URL,
  parseDataclawRowsResponse,
  parseSweSmithMessages,
  parseSweSmithRowsResponse,
  runSessionBundle,
  type DataclawRow,
  type OpenAgentSessionsRow,
  type SweSmithRow,
} from "../src/index.js";

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
  assert.equal(replayed.views.at(-1)?.activeInteractionId, bundle.outcomes.finalActiveInteractionId);
  assert.equal(replayed.views.at(-1)?.queuedInteractionIds.length, bundle.outcomes.finalQueuedCount);
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
  assert.equal(replayed.views.at(-1)?.activeInteractionId, bundle.outcomes.finalActiveInteractionId);
  assert.equal(replayed.views.at(-1)?.queuedInteractionIds.length, bundle.outcomes.finalQueuedCount);
  assert.equal(replayed.views.at(-1)?.ambientInteractionIds.length, bundle.outcomes.finalAmbientCount);
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
  assert.equal(replayed.views.at(-1)?.activeInteractionId, bundle.outcomes.finalActiveInteractionId);
  assert.equal(replayed.views.at(-1)?.queuedInteractionIds.length, bundle.outcomes.finalQueuedCount);
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
