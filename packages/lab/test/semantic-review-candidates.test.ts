import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  createSemanticReviewCandidateReportFromPaths,
  createSessionBundleFromSweSmithRow,
  digestJsonValue,
  digestPublicCorpusLedgerEntries,
  writeSessionBundle,
  type PublicCorpusRecordLedgerEntry,
  type PublicCorpusRunManifest,
  type SweSmithRow,
} from "../src/index.js";

const execFile = promisify(execFileCallback);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");
const TSX_CLI = path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");

const SAMPLE_ROW: SweSmithRow = {
  instance_id: "example/repo-123",
  model: "claude-3-7-sonnet-20250219",
  resolved: true,
  traj_id: "example/repo-123.run-42",
  patch:
    "diff --git a/file.py b/file.py\nindex 111..222 100644\n--- a/file.py\n+++ b/file.py\n@@\n-print('bad')\n+print('good')\n",
  messages: JSON.stringify([
    {
      role: "system",
      content: "You are a helpful assistant that can interact with a computer to solve tasks.",
      message_type: "system_prompt",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "We're solving ISSUE: MoneyWidget crashes on invalid provider responses.",
        },
      ],
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "I'll reproduce the failure first.",
      action: "pytest tests/test_widget.py",
      tool_calls: [
        {
          function: {
            name: "bash",
            arguments: '{"command":"pytest tests/test_widget.py"}',
          },
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
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "",
      action: "submit",
      tool_calls: [
        {
          function: {
            name: "submit",
            arguments: "{}",
          },
        },
      ],
      message_type: "action",
    },
  ]),
};

test("semantic review candidate reports shortlist deterministic review pressure", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-"));
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    maxCandidatesPerSessionPerKind: 1,
    repoRoot: tempDir,
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.selection.promotionAuthority, "review_required");
  assert.equal(report.input.scannedBundleCount, 1);
  assert.ok(report.summary.countsByKind.missing_why_now > 0);
  assert.ok(report.summary.countsByKind.failure_attention > 0);
  assert.ok(report.candidatesByKind.failure_attention.length <= 1);
  assert.equal(
    Object.hasOwn(report.candidatesByKind.failure_attention[0] ?? {}, "expectedValue"),
    false,
  );
  assert.deepEqual(report.candidatesByKind.failure_attention[0]?.reviewFocusAreas, [
    "status",
    "intentFrame",
    "toolFamily",
    "consequence",
  ]);
});

test("semantic review candidate reports flag unrecognized imported tool families", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-tools-"));
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  for (const normalized of bundle.normalizedEvents) {
    const event = normalized.event as { toolFamily?: string };
    if (event.toolFamily === "bash") {
      event.toolFamily = "python";
    }
  }
  for (const semantic of bundle.semanticSnapshots) {
    if (semantic.interpretation.toolFamily === "bash") {
      semantic.interpretation.toolFamily = "python";
    }
  }
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    repoRoot: tempDir,
  });

  assert.ok(report.summary.countsByKind.tool_taxonomy_gap > 0);
  assert.equal(report.candidatesByKind.tool_taxonomy_gap[0]?.semantic.toolFamily, "python");
});

test("semantic review candidate reports treat canonical write tool family as known", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-write-"));
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  for (const normalized of bundle.normalizedEvents) {
    const event = normalized.event as { toolFamily?: string };
    if (event.toolFamily === "bash") {
      event.toolFamily = "write";
    }
  }
  for (const semantic of bundle.semanticSnapshots) {
    if (semantic.interpretation.toolFamily === "bash") {
      semantic.interpretation.toolFamily = "write";
    }
  }
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    repoRoot: tempDir,
  });

  assert.equal(report.summary.countsByKind.tool_taxonomy_gap, 0);
});

test("review-candidates CLI writes JSON and markdown reports", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-cli-"));
  const bundlePath = path.join(tempDir, "bundles", "bundle.json");
  const outputPath = path.join(tempDir, "report");
  const markdownPath = path.join(tempDir, "report.md");
  await writeSessionBundle(bundlePath, createSessionBundleFromSweSmithRow(SAMPLE_ROW));

  const { stdout } = await execFile(
    process.execPath,
    [
      TSX_CLI,
      path.join(REPO_ROOT, "scripts/fstop.ts"),
      "review-candidates",
      "--bundle-dir",
      path.dirname(bundlePath),
      "--output",
      outputPath,
      "--limit-per-kind",
      "2",
      "--json",
    ],
    { cwd: REPO_ROOT },
  );

  const payload = JSON.parse(stdout) as {
    status: string;
    outputPath: string;
    markdownPath: string;
    input: Awaited<ReturnType<typeof createSemanticReviewCandidateReportFromPaths>>["input"];
    summary: Awaited<ReturnType<typeof createSemanticReviewCandidateReportFromPaths>>["summary"];
  };
  const markdown = await readFile(markdownPath, "utf8");

  assert.equal(payload.status, "ok");
  assert.equal(payload.outputPath, outputPath);
  assert.equal(payload.markdownPath, markdownPath);
  assert.equal(payload.input.scannedBundleCount, 1);
  assert.ok(payload.summary.countsByKind.failure_attention > 0);
  assert.match(markdown, /Semantic Review Candidate Census/);
  assert.match(markdown, /failure_attention/);
});

test("review-candidates CLI rejects missing path option values", async () => {
  await assert.rejects(
    execFile(
      process.execPath,
      [
        TSX_CLI,
        path.join(REPO_ROOT, "scripts/fstop.ts"),
        "review-candidates",
        "--bundle",
        "--json",
      ],
      { cwd: REPO_ROOT },
    ),
    /--bundle requires a path/,
  );
});

test("review-candidates CLI rejects colliding JSON and markdown outputs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-collision-"));
  const bundlePath = path.join(tempDir, "bundles", "bundle.json");
  const outputPath = path.join(tempDir, "report");
  await writeSessionBundle(bundlePath, createSessionBundleFromSweSmithRow(SAMPLE_ROW));

  await assert.rejects(
    execFile(
      process.execPath,
      [
        TSX_CLI,
        path.join(REPO_ROOT, "scripts/fstop.ts"),
        "review-candidates",
        "--bundle",
        bundlePath,
        "--output",
        outputPath,
        "--markdown-output",
        outputPath,
        "--json",
      ],
      { cwd: REPO_ROOT },
    ),
    /JSON and Markdown outputs must be different paths/,
  );
});

test("semantic review candidates can resolve bundles through a verified public corpus manifest", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-manifest-"));
  const runRoot = path.join(tempDir, "run");
  const bundleRoot = path.join(tempDir, "bundles");
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const bundlePath = path.join(bundleRoot, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const record: PublicCorpusRecordLedgerEntry = {
    offset: 42,
    rowIndex: 0,
    recordId: "trace:42",
    sourceIdentity: "trace/source/42",
    rowDigest: digestJsonValue({ row: 42 }),
    status: "written",
    sessionId: bundle.sessionId,
    bundlePath,
    bundleDigest: digestJsonValue(bundle),
    canonicalSessionDigest: digestJsonValue({ sessionId: bundle.sessionId }),
  };
  const recordsPath = path.join(runRoot, "records.jsonl");
  const errorsPath = path.join(runRoot, "errors.jsonl");
  const manifestPath = path.join(runRoot, "manifest.json");
  await mkdir(runRoot, { recursive: true });
  await writeFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  await writeFile(errorsPath, "", "utf8");

  const manifest = buildManifest({
    tempDir,
    runRoot,
    bundleRoot,
    manifestPath,
    recordsPath,
    errorsPath,
    recordsDigest: digestPublicCorpusLedgerEntries([record]),
    errorsDigest: digestPublicCorpusLedgerEntries([]),
    bundleSetDigest: digestJsonValue([record.bundleDigest]),
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const report = await createSemanticReviewCandidateReportFromPaths({
    manifestPaths: [manifestPath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 1,
    repoRoot: tempDir,
  });

  assert.equal(report.input.manifestRecordCount, 1);
  assert.equal(report.input.manifestBundleCount, 1);
  assert.equal(report.input.scannedBundleCount, 1);
  assert.equal(report.candidatesByKind.failure_attention[0]?.publicCorpus?.offset, 42);
  assert.equal(
    report.candidatesByKind.failure_attention[0]?.publicCorpus?.canonicalSessionDigest,
    record.canonicalSessionDigest,
  );
});

test("semantic review candidates reject manifest records whose bundle bytes drift", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-tamper-"));
  const runRoot = path.join(tempDir, "run");
  const bundleRoot = path.join(tempDir, "bundles");
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const bundlePath = path.join(bundleRoot, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const record: PublicCorpusRecordLedgerEntry = {
    offset: 42,
    rowIndex: 0,
    recordId: "trace:42",
    sourceIdentity: "trace/source/42",
    rowDigest: digestJsonValue({ row: 42 }),
    status: "written",
    sessionId: bundle.sessionId,
    bundlePath,
    bundleDigest: digestJsonValue(bundle),
    canonicalSessionDigest: digestJsonValue({ sessionId: bundle.sessionId }),
  };
  const recordsPath = path.join(runRoot, "records.jsonl");
  const errorsPath = path.join(runRoot, "errors.jsonl");
  const manifestPath = path.join(runRoot, "manifest.json");
  await mkdir(runRoot, { recursive: true });
  await writeFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  await writeFile(errorsPath, "", "utf8");

  const manifest = buildManifest({
    tempDir,
    runRoot,
    bundleRoot,
    manifestPath,
    recordsPath,
    errorsPath,
    recordsDigest: digestPublicCorpusLedgerEntries([record]),
    errorsDigest: digestPublicCorpusLedgerEntries([]),
    bundleSetDigest: digestJsonValue([record.bundleDigest]),
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeSessionBundle(bundlePath, { ...bundle, title: "tampered bundle" });

  await assert.rejects(
    createSemanticReviewCandidateReportFromPaths({
      manifestPaths: [manifestPath],
      generatedAt: "2026-04-27T00:00:00.000Z",
      maxCandidatesPerKind: 1,
      repoRoot: tempDir,
    }),
    /bundle digest mismatch/,
  );
});

test("semantic review candidates require completed manifest integrity", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-integrity-"));
  const runRoot = path.join(tempDir, "run");
  const bundleRoot = path.join(tempDir, "bundles");
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const bundlePath = path.join(bundleRoot, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const record: PublicCorpusRecordLedgerEntry = {
    offset: 42,
    rowIndex: 0,
    recordId: "trace:42",
    sourceIdentity: "trace/source/42",
    rowDigest: digestJsonValue({ row: 42 }),
    status: "written",
    sessionId: bundle.sessionId,
    bundlePath,
    bundleDigest: digestJsonValue(bundle),
  };
  const recordsPath = path.join(runRoot, "records.jsonl");
  const errorsPath = path.join(runRoot, "errors.jsonl");
  const manifestPath = path.join(runRoot, "manifest.json");
  await mkdir(runRoot, { recursive: true });
  await writeFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  await writeFile(errorsPath, "", "utf8");

  const manifest = buildManifest({
    tempDir,
    runRoot,
    bundleRoot,
    manifestPath,
    recordsPath,
    errorsPath,
    recordsDigest: digestPublicCorpusLedgerEntries([record]),
    errorsDigest: digestPublicCorpusLedgerEntries([]),
    bundleSetDigest: digestJsonValue([record.bundleDigest]),
  });
  manifest.status = "running";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    createSemanticReviewCandidateReportFromPaths({
      manifestPaths: [manifestPath],
      generatedAt: "2026-04-27T00:00:00.000Z",
      maxCandidatesPerKind: 1,
      repoRoot: tempDir,
    }),
    /manifest is not completed/,
  );

  manifest.status = "completed";
  delete manifest.integrity.bundleSetDigest;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    createSemanticReviewCandidateReportFromPaths({
      manifestPaths: [manifestPath],
      generatedAt: "2026-04-27T00:00:00.000Z",
      maxCandidatesPerKind: 1,
      repoRoot: tempDir,
    }),
    /lacks bundleSetDigest/,
  );
});

test("semantic review candidates do not load unverified skipped-existing records", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-skipped-"));
  const runRoot = path.join(tempDir, "run");
  const bundleRoot = path.join(tempDir, "bundles");
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const bundlePath = path.join(bundleRoot, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const record: PublicCorpusRecordLedgerEntry = {
    offset: 42,
    rowIndex: 0,
    recordId: "trace:42",
    sourceIdentity: "trace/source/42",
    rowDigest: digestJsonValue({ row: 42 }),
    status: "skipped_existing",
    sessionId: bundle.sessionId,
    bundlePath,
    bundleDigest: digestJsonValue(bundle),
  };
  const recordsPath = path.join(runRoot, "records.jsonl");
  const errorsPath = path.join(runRoot, "errors.jsonl");
  const manifestPath = path.join(runRoot, "manifest.json");
  await mkdir(runRoot, { recursive: true });
  await writeFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  await writeFile(errorsPath, "", "utf8");

  const manifest = buildManifest({
    tempDir,
    runRoot,
    bundleRoot,
    manifestPath,
    recordsPath,
    errorsPath,
    recordsDigest: digestPublicCorpusLedgerEntries([record]),
    errorsDigest: digestPublicCorpusLedgerEntries([]),
    bundleSetDigest: digestJsonValue([record.bundleDigest]),
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const report = await createSemanticReviewCandidateReportFromPaths({
    manifestPaths: [manifestPath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 1,
    repoRoot: tempDir,
  });

  assert.equal(report.input.manifestRecordCount, 1);
  assert.equal(report.input.manifestBundleCount, 0);
  assert.equal(report.input.scannedBundleCount, 0);
});

function buildManifest(input: {
  tempDir: string;
  runRoot: string;
  bundleRoot: string;
  manifestPath: string;
  recordsPath: string;
  errorsPath: string;
  recordsDigest: `sha256:${string}`;
  errorsDigest: `sha256:${string}`;
  bundleSetDigest?: `sha256:${string}`;
}): PublicCorpusRunManifest {
  return {
    schemaVersion: 2,
    runId: "trace-commons-train-o42-m1-p1-test",
    status: "completed",
    createdAt: "2026-04-27T00:00:00.000Z",
    startedAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:01.000Z",
    completedAt: "2026-04-27T00:00:01.000Z",
    source: {
      kind: "public-trajectory",
      adapter: "trace-commons",
      dataset: "trace-commons/agent-traces",
      upstream: "trace-commons/agent-traces",
      upstreamUrl: "https://huggingface.co/datasets/trace-commons/agent-traces",
      config: "default",
      split: "train",
      requestedRevision: "live_rows_api_unpinned",
      resolvedRevision: "live_rows_api_unpinned",
      reproducibility: "digest-verifiable",
    },
    plan: {
      dataset: "trace-commons",
      split: "train",
      startOffset: 42,
      maxRows: 1,
      pageSize: 1,
      requestTimeoutSeconds: 30,
      maxResponseBytes: 67_108_864,
      maxRetries: 2,
      existing: "verify",
      mirrorRaw: false,
      dryRun: false,
      planOnly: false,
    },
    runtime: {
      runtimeRoot: input.tempDir,
      cwd: input.tempDir,
      nodeVersion: process.version,
      importerSchemaVersion: 2,
    },
    privacy: {
      classification: "public_anonymized_best_effort",
      redactionPosture: "review_required_before_promotion",
      licenseScope: "dataset_compilation_cc_by_4.0_embedded_content_may_differ",
      rawRetention: "not_mirrored",
    },
    progress: {
      nextOffset: 43,
      pagesAttempted: 1,
      pagesCompleted: 1,
      rowsFetched: 1,
      rowsImported: 1,
      rowsSkipped: 0,
      rowsFailed: 0,
      rowsDuplicated: 0,
    },
    artifacts: {
      runRoot: input.runRoot,
      manifestPath: input.manifestPath,
      recordsPath: input.recordsPath,
      errorsPath: input.errorsPath,
      bundleRoot: input.bundleRoot,
    },
    integrity: {
      recordsDigest: input.recordsDigest,
      errorsDigest: input.errorsDigest,
      bundleSetDigest:
        input.bundleSetDigest ??
        digestJsonValue([digestJsonValue(createSessionBundleFromSweSmithRow(SAMPLE_ROW))]),
    },
  };
}
