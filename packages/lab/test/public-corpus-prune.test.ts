import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prunePublicCorpusBundles,
  runPublicCorpusImport,
  type DataclawRow,
  type TraceCommonsRow,
} from "../src/index.js";
import { parseCorpusPruneArgs } from "../src/fstop-cli-args-corpus-prune.js";

test("prunePublicCorpusBundles previews verified stale deletes and retains unmanaged files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-prune-preview-"));
  const runtimeRoot = path.join(directory, "runtime");
  const previous = await runPublicCorpusImport(
    {
      offset: 0,
      maxRows: 2,
      pageSize: 1,
      runtimeRoot,
      runId: "previous-run",
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    { fetchPage: async (request) => createTraceCommonsRows(request.offset, request.limit) },
  );
  const desired = await runPublicCorpusImport(
    {
      offset: 1,
      maxRows: 2,
      pageSize: 1,
      runtimeRoot,
      runId: "desired-run",
      exportedAt: "2026-03-29T00:00:00.000Z",
    },
    { fetchPage: async (request) => createTraceCommonsRows(request.offset, request.limit) },
  );
  const unmanagedPath = path.join(
    runtimeRoot,
    "bundles",
    "public",
    "trace-commons",
    "train",
    "unmanaged.fstop-session.json",
  );
  await mkdir(path.dirname(unmanagedPath), { recursive: true });
  await writeFile(unmanagedPath, "{}\n", "utf8");

  const report = await prunePublicCorpusBundles({
    manifestPaths: [desired.manifestPath!],
    previousManifestPaths: [previous.manifestPath!],
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.desiredBundleCount, 2);
  assert.equal(report.previousBundleCount, 2);
  assert.equal(report.staleBundleCount, 2);
  assert.equal(report.deletableBundleCount, 1);
  assert.equal(report.retainedUnmanagedBundleCount, 1);
  assert.equal(report.deletedBundleCount, 0);
  assert.deepEqual(report.retainedUnmanagedBundlePaths, [unmanagedPath]);
  await readFile(report.deletableBundlePaths[0]!, "utf8");
  await readFile(unmanagedPath, "utf8");
});

test("prunePublicCorpusBundles apply deletes exact previous-manifest stale files only", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-prune-apply-"));
  const runtimeRoot = path.join(directory, "runtime");
  const previous = await runPublicCorpusImport(
    {
      offset: 0,
      maxRows: 2,
      pageSize: 1,
      runtimeRoot,
      runId: "previous-run",
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    { fetchPage: async (request) => createTraceCommonsRows(request.offset, request.limit) },
  );
  const desired = await runPublicCorpusImport(
    {
      offset: 1,
      maxRows: 2,
      pageSize: 1,
      runtimeRoot,
      runId: "desired-run",
      exportedAt: "2026-03-29T00:00:00.000Z",
    },
    { fetchPage: async (request) => createTraceCommonsRows(request.offset, request.limit) },
  );
  const unmanagedPath = path.join(
    runtimeRoot,
    "bundles",
    "public",
    "trace-commons",
    "train",
    "unmanaged.fstop-session.json",
  );
  await mkdir(path.dirname(unmanagedPath), { recursive: true });
  await writeFile(unmanagedPath, "{}\n", "utf8");

  const report = await prunePublicCorpusBundles({
    manifestPaths: [desired.manifestPath!],
    previousManifestPaths: [previous.manifestPath!],
    apply: true,
  });

  assert.equal(report.mode, "apply");
  assert.equal(report.deletedBundleCount, 1);
  await assert.rejects(readFile(report.deletedBundlePaths[0]!, "utf8"), {
    code: "ENOENT",
  });
  await readFile(unmanagedPath, "utf8");
  for (const bundlePath of desired.bundlePaths) {
    await readFile(bundlePath, "utf8");
  }
});

test("prunePublicCorpusBundles retains stale files whose previous-manifest digest drifted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-prune-drift-"));
  const runtimeRoot = path.join(directory, "runtime");
  const previous = await runPublicCorpusImport(
    {
      offset: 0,
      maxRows: 1,
      pageSize: 1,
      runtimeRoot,
      runId: "previous-run",
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    { fetchPage: async (request) => createTraceCommonsRows(request.offset, request.limit) },
  );
  const desired = await runPublicCorpusImport(
    {
      offset: 1,
      maxRows: 1,
      pageSize: 1,
      runtimeRoot,
      runId: "desired-run",
      exportedAt: "2026-03-29T00:00:00.000Z",
    },
    { fetchPage: async (request) => createTraceCommonsRows(request.offset, request.limit) },
  );
  await writeFile(previous.bundlePaths[0]!, "{}\n", "utf8");

  const report = await prunePublicCorpusBundles({
    manifestPaths: [desired.manifestPath!],
    previousManifestPaths: [previous.manifestPath!],
    apply: true,
  });

  assert.equal(report.deletedBundleCount, 0);
  assert.deepEqual(report.retainedDriftedPreviousBundlePaths, [previous.bundlePaths[0]]);
  await readFile(previous.bundlePaths[0]!, "utf8");
});

test("prunePublicCorpusBundles rejects partial completed manifests as prune authority", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-prune-partial-"));
  const runtimeRoot = path.join(directory, "runtime");
  const partial = await runPublicCorpusImport(
    {
      offset: 0,
      maxRows: 2,
      pageSize: 2,
      runtimeRoot,
      runId: "partial-run",
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    {
      fetchPage: async (request) =>
        request.offset === 0 ? createTraceCommonsRows(request.offset, 1) : [],
    },
  );

  await assert.rejects(
    prunePublicCorpusBundles({ manifestPaths: [partial.manifestPath!] }),
    /full completed manifest coverage/,
  );
});

test("prunePublicCorpusBundles rejects DataClaw manifests before scanning", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-prune-dataclaw-"));
  const runtimeRoot = path.join(directory, "runtime");
  const dataclaw = await runPublicCorpusImport(
    {
      dataset: "dataclaw",
      maxRows: 1,
      runtimeRoot,
      runId: "dataclaw-run",
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    { fetchPage: async () => [createDataclawRow(0)] },
  );

  await assert.rejects(
    prunePublicCorpusBundles({ manifestPaths: [dataclaw.manifestPath!], apply: true }),
    /Trace Commons manifests only/,
  );
  await readFile(dataclaw.bundlePaths[0]!, "utf8");
});

test("parseCorpusPruneArgs accepts desired and previous manifests but defaults to preview", () => {
  const options = parseCorpusPruneArgs([
    "--manifest",
    "/tmp/desired-manifest.json",
    "--previous-manifest",
    "/tmp/previous-manifest.json",
    "--json",
  ]);

  assert.deepEqual(options.manifestPaths, ["/tmp/desired-manifest.json"]);
  assert.deepEqual(options.previousManifestPaths, ["/tmp/previous-manifest.json"]);
  assert.equal(options.apply, undefined);
  assert.equal(options.json, true);
});

function createTraceCommonsRows(offset: number, limit: number): TraceCommonsRow[] {
  return Array.from({ length: limit }, (_, index) => createTraceCommonsRow(offset + index));
}

function createDataclawRow(index: number): DataclawRow {
  const timestamp = new Date(Date.UTC(2026, 2, 28, 0, 0, index)).toISOString();
  return {
    session_id: `dataclaw-session-${index}`,
    model: "claude-sonnet",
    project: "aperture",
    source: "claude",
    start_time: timestamp,
    messages: [
      {
        role: "user",
        content: `Fix the DataClaw parser ${index}.`,
        timestamp,
      },
      {
        role: "assistant",
        content: "I will inspect the failing test first.",
        timestamp,
        tool_uses: [
          {
            tool: "exec_command",
            input: { cmd: "pnpm test parser" },
            output: "AssertionError: parser missed a tool result",
            status: "failed",
          },
        ],
      },
    ],
  };
}

function createTraceCommonsRow(index: number): TraceCommonsRow {
  const timestamp = new Date(Date.UTC(2026, 2, 28, 0, 0, index)).toISOString();
  return {
    harness: "codex",
    session_id: `trace-session-${index}`,
    prompt: `Patch the failing parser ${index}.`,
    sent_at: timestamp,
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
        timestamp,
      },
    ],
    messages: [
      {
        role: "user",
        content: `Patch the failing parser ${index}.`,
        timestamp,
      },
      {
        role: "assistant",
        content: "I'll run the focused parser test first.",
        timestamp,
        tool_calls: [
          {
            id: `call-shell-${index}`,
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
        tool_call_id: `call-shell-${index}`,
        content: "AssertionError: expected parser result to include tool calls",
        timestamp,
      },
    ],
  };
}
