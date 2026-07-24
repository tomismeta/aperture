import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  FSTOP_SESSION_SCHEMA_VERSION,
  importTrajectoryBundlesFromFile,
  loadSessionBundle,
  resolveAutoresearchInputFile,
  type DataclawRow,
  type FStopSession,
  type PiRow,
  type TraceCommonsRow,
} from "../src/index.js";

const SAMPLE_DATACLAW_ROW: DataclawRow = {
  session_id: "123e4567-e89b-12d3-a456-426614174000",
  source: "claude",
  project: "demo-project",
  model: "claude-sonnet-4",
  start_time: "2026-03-28T00:00:00.000Z",
  end_time: "2026-03-28T00:05:00.000Z",
  git_branch: "main",
  messages: [
    {
      role: "user",
      content: "Add retry logic to @src/client.ts and explain the fix.",
      timestamp: "2026-03-28T00:00:10.000Z",
    },
    {
      role: "assistant",
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
            text: "1 export async function request() {\n2 return fetch('/api');\n3 }",
          },
          status: "success",
        },
      ],
    },
  ],
};

const SAMPLE_TRACE_COMMONS_ROW: TraceCommonsRow = {
  harness: "codex",
  session_id: "3918c264-8ef4-4d0f-9606-9b49ab97984f",
  prompt: "Inspect the failing test and fix the parser.",
  sent_at: "2026-06-14T12:00:00.000Z",
  num_user_messages: 1,
  num_tool_calls: 1,
  tools: [
    {
      type: "function",
      function: {
        name: "shell",
      },
    },
  ],
  trace: [
    {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: "2026-06-14T12:00:00.000Z",
    },
  ],
  messages: [
    {
      role: "user",
      content: "Inspect the failing test and fix the parser.",
      timestamp: "2026-06-14T12:00:00.000Z",
    },
    {
      role: "assistant",
      content: "I'll run the focused parser test first.",
      timestamp: "2026-06-14T12:00:05.000Z",
      tool_calls: [
        {
          id: "call-shell-1",
          type: "function",
          function: {
            name: "shell",
            arguments: "{\"command\":\"pnpm test parser\"}",
          },
        },
      ],
    },
    {
      role: "tool",
      name: "shell",
      tool_call_id: "call-shell-1",
      content: "AssertionError: expected parser result to include tool calls",
      timestamp: "2026-06-14T12:00:10.000Z",
    },
  ],
};

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PI_FIXTURE_PATH = path.join(TEST_DIRECTORY, "fixtures", "pi-mono-row.json");

test("importTrajectoryBundlesFromFile imports a raw DataClaw row JSON file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-fstop-ingest-"));
  const sourcePath = path.join(directory, "dataclaw-row.json");
  const outputDirectory = path.join(directory, "bundles");
  await writeFile(sourcePath, `${JSON.stringify(SAMPLE_DATACLAW_ROW, null, 2)}\n`, "utf8");

  const imported = await importTrajectoryBundlesFromFile({
    filePath: sourcePath,
    outputDirectory,
  });

  assert.equal(imported.length, 1);
  assert.equal(imported[0]?.dataset, "dataclaw");
  assert.match(imported[0]?.filePath ?? "", /bundles\/dataclaw\/train\/public-dataclaw-/);
  assert.match(imported[0]?.sessionFilePath ?? "", /sessions\/dataclaw\/train\/public-dataclaw-/);

  const bundle = await loadSessionBundle(imported[0]!.filePath);
  assert.equal(bundle.sessionId, "public:dataclaw:123e4567-e89b-12d3-a456-426614174000");
  assert.ok(bundle.source?.capture?.notes?.includes(`input_file=${sourcePath}`));
});

test("importTrajectoryBundlesFromFile imports a Trace Commons rows payload", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-fstop-ingest-trace-commons-"));
  const sourcePath = path.join(directory, "trace-commons-rows.json");
  const outputDirectory = path.join(directory, "bundles");
  await writeFile(
    sourcePath,
    `${JSON.stringify({ rows: [{ row: SAMPLE_TRACE_COMMONS_ROW }] }, null, 2)}\n`,
    "utf8",
  );

  const imported = await importTrajectoryBundlesFromFile({
    filePath: sourcePath,
    outputDirectory,
    dataset: "trace-commons",
  });

  assert.equal(imported.length, 1);
  assert.equal(imported[0]?.dataset, "trace-commons");
  assert.match(imported[0]?.filePath ?? "", /bundles\/trace-commons\/train\/public-trace-commons-/);
  assert.match(imported[0]?.sessionFilePath ?? "", /sessions\/trace-commons\/train\/public-trace-commons-/);

  const bundle = await loadSessionBundle(imported[0]!.filePath);
  assert.equal(bundle.sessionId, "public:trace-commons:codex:3918c264-8ef4-4d0f-9606-9b49ab97984f");
  assert.ok(bundle.source?.capture?.notes?.includes("dataset=trace-commons/agent-traces"));
  assert.ok(bundle.source?.capture?.notes?.includes(`input_file=${sourcePath}`));
});

test("importTrajectoryBundlesFromFile imports a raw Pi row JSON file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-fstop-ingest-pi-"));
  const sourcePath = path.join(directory, "pi-row.json");
  const outputDirectory = path.join(directory, "bundles");
  const samplePiRow = JSON.parse(await readFile(SAMPLE_PI_FIXTURE_PATH, "utf8")) as PiRow;
  await writeFile(sourcePath, `${JSON.stringify(samplePiRow, null, 2)}\n`, "utf8");

  const imported = await importTrajectoryBundlesFromFile({
    filePath: sourcePath,
    outputDirectory,
  });

  assert.equal(imported.length, 1);
  assert.equal(imported[0]?.dataset, "pi");
  assert.match(imported[0]?.filePath ?? "", /bundles\/pi\/train\/public-pi-/);
  assert.match(imported[0]?.sessionFilePath ?? "", /sessions\/pi\/train\/public-pi-/);

  const bundle = await loadSessionBundle(imported[0]!.filePath);
  assert.equal(bundle.sessionId, "public:pi:pi-session-42");
  assert.ok(bundle.source?.capture?.notes?.includes(`input_file=${sourcePath}`));
  assert.ok(bundle.source?.capture?.notes?.includes("dataset=pi"));

  const sessionText = await readFile(imported[0]!.sessionFilePath!, "utf8");
  const session = JSON.parse(sessionText) as FStopSession;
  assert.ok(session.entries.some((entry) => entry.entryId === "assistant-1"));
  assert.ok(session.entries.some((entry) => entry.parentEntryId === "assistant-1" && entry.kind === "tool_call"));
  assert.ok(session.source?.capture?.notes?.includes("path_mode=deepest-leaf"));
  assert.ok(!session.entries.some((entry) => entry.text?.includes("Ignore that alternate branch.")));
});

test("resolveAutoresearchInputFile auto-ingests Pi JSONL raw exports", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-fstop-ingest-pi-jsonl-"));
  const outputDirectory = path.join(directory, "bundles");
  const jsonlPath = path.join(directory, "pi-session.jsonl");
  const samplePiRow = JSON.parse(await readFile(SAMPLE_PI_FIXTURE_PATH, "utf8")) as PiRow;
  const jsonlText = samplePiRow.traces.map((trace) => JSON.stringify(trace)).join("\n");
  await writeFile(jsonlPath, `${jsonlText}\n`, "utf8");

  const resolved = await resolveAutoresearchInputFile(jsonlPath, {
    outputDirectory,
  });

  assert.equal(resolved.batchReportPath, undefined);
  assert.equal(resolved.bundlePaths?.length, 1);
  assert.equal(resolved.ingest?.bundleCount, 1);
  assert.deepEqual(resolved.ingest?.datasets, ["pi"]);

  const bundlePath = resolved.bundlePaths?.[0];
  assert.ok(bundlePath);
  assert.match(bundlePath!, /bundles\/pi\/train\/public-pi-/);

  const bundleText = await readFile(bundlePath!, "utf8");
  assert.match(bundleText, /public:pi:/i);
});

test("resolveAutoresearchInputFile treats Pi-family JSONL with session cwd as pi, not OpenAgentSessions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-fstop-ingest-pi-sero-"));
  const outputDirectory = path.join(directory, "bundles");
  const jsonlPath = path.join(directory, "pi-family-session.jsonl");
  const events = [
    {
      type: "session",
      id: "pi-family-session",
      timestamp: "2025-12-29T14:32:08.229Z",
      cwd: "/Users/sero/projects/maze/vault-2",
    },
    {
      type: "message",
      timestamp: "2025-12-29T14:32:21.319Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "can you please complete @challenge-1/" }],
        timestamp: 1767018741310,
      },
    },
    {
      type: "message",
      timestamp: "2025-12-29T14:32:22.999Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I'll inspect the directory first." },
          { type: "toolCall", id: "call-1", name: "read", arguments: { file_path: "challenge-1/intro.txt" } },
        ],
        api: "openai-completions",
        provider: "homelabai",
        model: "glm-4.6",
        usage: { totalTokens: 42 },
        stopReason: "toolUse",
        timestamp: 1767018741312,
      },
    },
    {
      type: "message",
      timestamp: "2025-12-29T14:32:23.244Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "print('hello from pi')" }],
        isError: false,
        timestamp: 1767018743243,
      },
    },
  ];
  await writeFile(jsonlPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");

  const resolved = await resolveAutoresearchInputFile(jsonlPath, {
    outputDirectory,
  });

  assert.equal(resolved.ingest?.bundleCount, 1);
  assert.deepEqual(resolved.ingest?.datasets, ["pi"]);
  assert.match(resolved.bundlePaths?.[0] ?? "", /bundles\/pi\/train\/public-pi-/);
});

test("resolveAutoresearchInputFile auto-ingests OpenAgentSessions JSONL raw exports", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-fstop-ingest-jsonl-"));
  const outputDirectory = path.join(directory, "bundles");
  const jsonlPath = path.join(directory, "session.redacted.jsonl");
  const events = [
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
            text: "Let's make an extension that redacts the session before sharing it.",
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
            type: "text",
            text: "I'll inspect the extension hooks first.",
          },
        ],
      },
    },
  ];
  await writeFile(jsonlPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  await writeFile(
    path.join(directory, "openagentsessions.json"),
    `${JSON.stringify({
      session: {
        agent: "pi",
        model: "gpt-5.4",
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const resolved = await resolveAutoresearchInputFile(jsonlPath, {
    outputDirectory,
  });

  assert.equal(resolved.batchReportPath, undefined);
  assert.equal(resolved.bundlePaths?.length, 1);
  assert.equal(resolved.ingest?.bundleCount, 1);
  assert.deepEqual(resolved.ingest?.datasets, ["open-agent-sessions"]);

  const bundlePath = resolved.bundlePaths?.[0];
  assert.ok(bundlePath);
  const bundleText = await readFile(bundlePath!, "utf8");
  assert.match(bundleText, /open-agent-sessions/i);
});

test("resolveAutoresearchInputFile compiles a canonical F-Stop session file into a bundle", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-fstop-session-file-"));
  const outputDirectory = path.join(directory, "bundles");
  const sessionPath = path.join(directory, "demo.fstop-session.json");
  const session: FStopSession = {
    schemaVersion: FSTOP_SESSION_SCHEMA_VERSION,
    sessionId: "fstop:demo-session",
    traceId: "trace-demo-session",
    title: "Demo canonical session",
    importedAt: "2026-03-29T00:00:00.000Z",
    entries: [
      {
        index: 0,
        timestamp: "2026-03-29T00:00:00.000Z",
        entryId: "entry-0",
        role: "user",
        kind: "message",
        significance: "attention",
        text: "Check the runtime shape.",
        sourceEvent: {
          id: "fstop:demo-session:start",
          type: "task.started",
          taskId: "fstop:demo-session",
          timestamp: "2026-03-29T00:00:00.000Z",
          title: "Check the runtime shape",
        },
      },
    ],
  };
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");

  const resolved = await resolveAutoresearchInputFile(sessionPath, {
    outputDirectory,
  });

  assert.equal(resolved.bundlePaths?.length, 1);
  assert.equal(resolved.ingest?.sourceKind, "fstop-session");
  assert.deepEqual(resolved.ingest?.sessionFilePaths, [sessionPath]);
  assert.equal(resolved.ingest?.datasets, undefined);

  const bundle = await loadSessionBundle(resolved.bundlePaths![0]!);
  assert.equal(bundle.sessionId, "fstop:demo-session");
});
