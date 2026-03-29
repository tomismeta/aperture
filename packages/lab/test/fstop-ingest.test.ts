import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FSTOP_SESSION_SCHEMA_VERSION,
  importTrajectoryBundlesFromFile,
  loadSessionBundle,
  resolveAutoresearchInputFile,
  type DataclawRow,
  type FStopSession,
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
