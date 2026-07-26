import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_PUBLIC_CORPUS_MAX_RESPONSE_BYTES,
  MAX_PUBLIC_CORPUS_RESPONSE_BYTES,
  createSessionBundleFromDataclawRow,
  fetchJsonWithPolicy,
  isPublicCorpusRunManifest,
  renderPublicCorpusRunMarkdown,
  runPublicCorpusImport,
  writePublicCorpusRunManifestAtomic,
  type DataclawRow,
  type PublicCorpusPageRequest,
  type PublicCorpusRunManifest,
  type TraceCommonsPageRequest,
  type TraceCommonsRow,
} from "../src/index.js";
import { PUBLIC_CORPUS_RUN_SCHEMA_VERSION } from "../src/artifact-versions.js";
import { parseCorpusRunArgs } from "../src/fstop-cli-args-corpus.js";
import { runCorpusRunCli } from "../src/fstop-cli-corpus.js";
import { digestJsonValue } from "../src/public-corpus-manifest.js";

test("runPublicCorpusImport writes manifest and record ledger without raw rows", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-run-"));
  const runtimeRoot = path.join(directory, "runtime");
  const calls: TraceCommonsPageRequest[] = [];

  const result = await runPublicCorpusImport(
    {
      offset: 4,
      maxRows: 4,
      pageSize: 2,
      runtimeRoot,
      runId: "fixture-run",
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    {
      fetchPage: async (request) => {
        calls.push(request);
        return createTraceCommonsRows(request.offset, request.limit);
      },
    },
  );

  assert.equal(result.manifest.runId, "fixture-run");
  assert.equal(result.manifest.status, "completed");
  assert.equal(result.manifest.progress.rowsImported, 4);
  assert.equal(result.manifest.progress.pagesCompleted, 2);
  assert.deepEqual(
    calls.map((call) => call.offset),
    [4, 6],
  );
  assert.deepEqual(
    calls.map((call) => call.limit),
    [2, 2],
  );
  assert.deepEqual(
    calls.map((call) => call.maxBytes),
    [DEFAULT_PUBLIC_CORPUS_MAX_RESPONSE_BYTES, DEFAULT_PUBLIC_CORPUS_MAX_RESPONSE_BYTES],
  );
  assert.ok(result.manifestPath);
  assert.ok(result.markdownPath);
  assert.ok(result.recordsPath);
  assert.equal(result.bundlePaths.length, 4);

  const manifestText = await readFile(result.manifestPath!, "utf8");
  const manifest = JSON.parse(manifestText) as PublicCorpusRunManifest;
  assert.equal(manifest.schemaVersion, PUBLIC_CORPUS_RUN_SCHEMA_VERSION);
  assert.equal(manifest.plan.maxResponseBytes, DEFAULT_PUBLIC_CORPUS_MAX_RESPONSE_BYTES);
  assert.equal(manifest.artifacts.bundleRoot, path.join(runtimeRoot, "bundles", "public"));
  assert.match(manifest.integrity.recordsDigest ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.match(manifest.integrity.bundleSetDigest ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.ok(!manifestText.includes("Patch the failing parser."));

  const recordLines = (await readFile(result.recordsPath!, "utf8")).trim().split("\n");
  assert.equal(recordLines.length, 4);
  const firstRecord = JSON.parse(recordLines[0]!) as Record<string, unknown>;
  assert.match(String(firstRecord.rowDigest), /^sha256:[a-f0-9]{64}$/);
  assert.match(String(firstRecord.bundleDigest), /^sha256:[a-f0-9]{64}$/);
  assert.equal(firstRecord.status, "written");

  const markdown = await readFile(result.markdownPath!, "utf8");
  assert.match(markdown, /Public Corpus Run/);
  assert.match(markdown, /Rows: 4 imported/);
  assert.match(markdown, /pnpm lab:fstop:review/);
});

test("runPublicCorpusImport writes DataClaw manifests and records through managed corpus runner", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-run-dataclaw-"));
  const runtimeRoot = path.join(directory, "runtime");
  const calls: PublicCorpusPageRequest[] = [];

  const result = await runPublicCorpusImport(
    {
      dataset: "dataclaw",
      offset: 0,
      maxRows: 2,
      runtimeRoot,
      runId: "dataclaw-run",
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    {
      fetchPage: async (request) => {
        calls.push(request);
        return createDataclawRows(request.offset, request.limit);
      },
    },
  );

  assert.equal(result.manifest.runId, "dataclaw-run");
  assert.equal(result.manifest.status, "completed");
  assert.equal(result.manifest.plan.dataset, "dataclaw");
  assert.equal(result.manifest.plan.pageSize, 1);
  assert.equal(result.manifest.source.dataset, "woctordho/dataclaw");
  assert.equal(
    result.manifest.privacy.licenseScope,
    "dataset_license_review_required_embedded_content_may_differ",
  );
  assert.equal(result.manifest.privacy.classification, "public_unredacted_review_required");
  assert.deepEqual(
    calls.map((call) => [call.dataset, call.offset, call.limit]),
    [
      ["dataclaw", 0, 1],
      ["dataclaw", 1, 1],
    ],
  );
  assert.equal(result.bundlePaths.length, 2);
  assert.ok(result.bundlePaths.every((bundlePath) => bundlePath.includes("/dataclaw/train/")));

  const recordLines = (await readFile(result.recordsPath!, "utf8")).trim().split("\n");
  assert.equal(recordLines.length, 2);
  const firstRecord = JSON.parse(recordLines[0]!) as Record<string, unknown>;
  assert.equal(firstRecord.recordId, "dataclaw-session-0");
  assert.equal(firstRecord.status, "written");
  assert.match(String(firstRecord.bundleDigest), /^sha256:[a-f0-9]{64}$/);
});

test("DataClaw corpus bundles are deterministic across wall-clock time", async () => {
  const row = createDataclawRow(7);
  const first = createSessionBundleFromDataclawRow(row);
  const second = createSessionBundleFromDataclawRow(row);

  assert.deepEqual(first, second);
  assert.equal(digestJsonValue(first), digestJsonValue(second));
});

test("runPublicCorpusImport stops at an empty page by default", async () => {
  const calls: TraceCommonsPageRequest[] = [];

  const result = await runPublicCorpusImport(
    {
      offset: 0,
      maxRows: 4,
      pageSize: 1,
      dryRun: true,
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    {
      fetchPage: async (request) => {
        calls.push(request);
        return request.offset === 2 ? [] : createTraceCommonsRows(request.offset, request.limit);
      },
    },
  );

  assert.deepEqual(
    calls.map((call) => call.offset),
    [0, 1, 2],
  );
  assert.equal(result.manifest.progress.rowsFetched, 2);
  assert.equal(result.manifest.progress.rowsImported, 2);
  assert.equal(result.manifest.progress.pagesCompleted, 3);
  assert.equal(result.manifest.progress.nextOffset, 2);
  assert.equal(result.manifestPath, undefined);
  assert.equal(result.markdownPath, undefined);
});

test("runPublicCorpusImport verifies existing bundles across run timestamps", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-run-existing-"));
  const runtimeRoot = path.join(directory, "runtime");
  const fetchPage = async (request: TraceCommonsPageRequest): Promise<TraceCommonsRow[]> =>
    createTraceCommonsRows(request.offset, request.limit);

  await runPublicCorpusImport(
    {
      maxRows: 1,
      pageSize: 1,
      runtimeRoot,
      runId: "existing-first",
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    { fetchPage },
  );

  const second = await runPublicCorpusImport(
    {
      maxRows: 1,
      pageSize: 1,
      runtimeRoot,
      runId: "existing-second",
      exportedAt: "2026-04-01T00:00:00.000Z",
    },
    { fetchPage },
  );

  assert.equal(second.manifest.status, "completed");
  assert.equal(second.manifest.progress.rowsImported, 1);
  const recordLines = (await readFile(second.recordsPath!, "utf8")).trim().split("\n");
  const record = JSON.parse(recordLines[0]!) as Record<string, unknown>;
  assert.equal(record.status, "verified_existing");
});

test("runPublicCorpusImport checkpoints trusted empty ledger digests before fetch", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-run-prefetch-"));
  const runtimeRoot = path.join(directory, "runtime");
  const manifestPath = path.join(runtimeRoot, "corpus-runs", "prefetch-run", "manifest.json");
  let inspectedCheckpoint = false;

  await runPublicCorpusImport(
    {
      maxRows: 1,
      pageSize: 1,
      runtimeRoot,
      runId: "prefetch-run",
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    {
      fetchPage: async () => {
        const manifest = JSON.parse(
          await readFile(manifestPath, "utf8"),
        ) as PublicCorpusRunManifest;
        assert.equal(manifest.status, "running");
        assert.equal(manifest.progress.pagesAttempted, 1);
        assert.match(manifest.integrity.recordsDigest ?? "", /^sha256:[a-f0-9]{64}$/);
        assert.match(manifest.integrity.errorsDigest ?? "", /^sha256:[a-f0-9]{64}$/);
        inspectedCheckpoint = true;
        return [];
      },
    },
  );

  assert.equal(inspectedCheckpoint, true);
});

test("runPublicCorpusImport resumes from repaired ledger without duplicating records", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-run-resume-"));
  const runtimeRoot = path.join(directory, "runtime");
  await assert.rejects(
    runPublicCorpusImport(
      {
        maxRows: 4,
        pageSize: 2,
        runtimeRoot,
        runId: "resume-run",
        exportedAt: "2026-03-28T00:00:00.000Z",
      },
      {
        fetchPage: async (request) => {
          if (request.offset === 2) {
            throw new Error("simulated network failure");
          }
          return createTraceCommonsRows(request.offset, request.limit);
        },
      },
    ),
    /simulated network failure/,
  );

  const manifestPath = path.join(runtimeRoot, "corpus-runs", "resume-run", "manifest.json");
  const recordsPath = path.join(runtimeRoot, "corpus-runs", "resume-run", "records.jsonl");
  const staleManifest = JSON.parse(await readFile(manifestPath, "utf8")) as PublicCorpusRunManifest;
  staleManifest.progress.nextOffset = 0;
  staleManifest.progress.rowsFetched = 0;
  staleManifest.progress.rowsImported = 0;
  await writeFile(manifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`, "utf8");
  await writeFile(recordsPath, `${await readFile(recordsPath, "utf8")}{"partial"`, "utf8");

  const calls: TraceCommonsPageRequest[] = [];
  const resumed = await runPublicCorpusImport(
    {
      resumeManifestPath: manifestPath,
    },
    {
      fetchPage: async (request) => {
        calls.push(request);
        return createTraceCommonsRows(request.offset, request.limit);
      },
    },
  );

  assert.equal(resumed.manifest.status, "completed");
  assert.deepEqual(
    calls.map((call) => call.offset),
    [2],
  );
  assert.equal(resumed.manifest.progress.rowsImported, 4);
  assert.equal(resumed.manifest.progress.nextOffset, 4);
  const recordLines = (await readFile(recordsPath, "utf8")).trim().split("\n");
  assert.equal(recordLines.length, 4);
  assert.ok(recordLines.every((line) => JSON.parse(line)));
});

test("runPublicCorpusImport survives a repeated crash after resume", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-run-repeat-resume-"));
  const runtimeRoot = path.join(directory, "runtime");
  await assert.rejects(
    runPublicCorpusImport(
      {
        maxRows: 4,
        pageSize: 2,
        runtimeRoot,
        runId: "repeat-resume-run",
        exportedAt: "2026-03-28T00:00:00.000Z",
      },
      {
        fetchPage: async (request) => {
          if (request.offset === 2) throw new Error("first stop");
          return createTraceCommonsRows(request.offset, request.limit);
        },
      },
    ),
    /first stop/,
  );

  const manifestPath = path.join(runtimeRoot, "corpus-runs", "repeat-resume-run", "manifest.json");
  const recordsPath = path.join(runtimeRoot, "corpus-runs", "repeat-resume-run", "records.jsonl");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PublicCorpusRunManifest;
  manifest.status = "running";
  manifest.progress.nextOffset = 2;
  manifest.progress.rowsFetched = 2;
  manifest.progress.rowsImported = 2;
  delete manifest.termination;
  const row = createTraceCommonsRow(2);
  await writeFile(
    recordsPath,
    `${await readFile(recordsPath, "utf8")}${JSON.stringify(createSyntheticRecord(2, row))}\n`,
    "utf8",
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const calls: TraceCommonsPageRequest[] = [];
  const resumed = await runPublicCorpusImport(
    { resumeManifestPath: manifestPath },
    {
      fetchPage: async (request) => {
        calls.push(request);
        return createTraceCommonsRows(request.offset, request.limit);
      },
    },
  );

  assert.deepEqual(
    calls.map((call) => call.offset),
    [3],
  );
  assert.equal(resumed.manifest.progress.rowsImported, 4);
  assert.equal((await readFile(recordsPath, "utf8")).trim().split("\n").length, 4);
});

test("runPublicCorpusImport rejects appended ledger rows from a clean failed manifest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-run-tamper-"));
  const runtimeRoot = path.join(directory, "runtime");
  await assert.rejects(
    runPublicCorpusImport(
      {
        maxRows: 4,
        pageSize: 2,
        runtimeRoot,
        runId: "tamper-run",
        exportedAt: "2026-03-28T00:00:00.000Z",
      },
      {
        fetchPage: async (request) => {
          if (request.offset === 2) throw new Error("stop before resume");
          return createTraceCommonsRows(request.offset, request.limit);
        },
      },
    ),
    /stop before resume/,
  );

  const manifestPath = path.join(runtimeRoot, "corpus-runs", "tamper-run", "manifest.json");
  const recordsPath = path.join(runtimeRoot, "corpus-runs", "tamper-run", "records.jsonl");
  await writeFile(
    recordsPath,
    `${await readFile(recordsPath, "utf8")}${JSON.stringify(createSyntheticRecord(2, createTraceCommonsRow(2)))}\n`,
    "utf8",
  );

  await assert.rejects(
    runPublicCorpusImport({ resumeManifestPath: manifestPath }, { fetchPage: async () => [] }),
    /ledger digest mismatch/,
  );
});

test("runPublicCorpusImport rejects running ledger rows without a trusted checkpoint digest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-run-missing-digest-"));
  const runtimeRoot = path.join(directory, "runtime");
  await assert.rejects(
    runPublicCorpusImport(
      {
        maxRows: 4,
        pageSize: 2,
        runtimeRoot,
        runId: "missing-digest-run",
        exportedAt: "2026-03-28T00:00:00.000Z",
      },
      {
        fetchPage: async (request) => {
          if (request.offset === 2) throw new Error("checkpoint before crash");
          return createTraceCommonsRows(request.offset, request.limit);
        },
      },
    ),
    /checkpoint before crash/,
  );

  const manifestPath = path.join(runtimeRoot, "corpus-runs", "missing-digest-run", "manifest.json");
  const recordsPath = path.join(runtimeRoot, "corpus-runs", "missing-digest-run", "records.jsonl");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PublicCorpusRunManifest;
  manifest.status = "running";
  manifest.progress.nextOffset = 2;
  manifest.progress.rowsFetched = 2;
  manifest.progress.rowsImported = 2;
  manifest.integrity = {};
  delete manifest.termination;
  await writeFile(
    recordsPath,
    `${await readFile(recordsPath, "utf8")}${JSON.stringify(createSyntheticRecord(2, createTraceCommonsRow(2)))}\n`,
    "utf8",
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    runPublicCorpusImport({ resumeManifestPath: manifestPath }, { fetchPage: async () => [] }),
    /ledger digest mismatch/,
  );
});

test("runPublicCorpusImport rejects duplicate outcomes across record and error ledgers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-run-duplicate-outcome-"));
  const runtimeRoot = path.join(directory, "runtime");
  await assert.rejects(
    runPublicCorpusImport(
      {
        maxRows: 4,
        pageSize: 2,
        runtimeRoot,
        runId: "duplicate-outcome-run",
        exportedAt: "2026-03-28T00:00:00.000Z",
      },
      {
        fetchPage: async (request) => {
          if (request.offset === 2) throw new Error("checkpoint before duplicate");
          return createTraceCommonsRows(request.offset, request.limit);
        },
      },
    ),
    /checkpoint before duplicate/,
  );

  const manifestPath = path.join(
    runtimeRoot,
    "corpus-runs",
    "duplicate-outcome-run",
    "manifest.json",
  );
  const recordsPath = path.join(
    runtimeRoot,
    "corpus-runs",
    "duplicate-outcome-run",
    "records.jsonl",
  );
  const errorsPath = path.join(runtimeRoot, "corpus-runs", "duplicate-outcome-run", "errors.jsonl");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PublicCorpusRunManifest;
  manifest.status = "running";
  manifest.progress.nextOffset = 2;
  manifest.progress.rowsFetched = 2;
  manifest.progress.rowsImported = 2;
  delete manifest.termination;
  const row = createTraceCommonsRow(2);
  await writeFile(
    recordsPath,
    `${await readFile(recordsPath, "utf8")}${JSON.stringify(createSyntheticRecord(2, row))}\n`,
    "utf8",
  );
  await writeFile(
    errorsPath,
    `${JSON.stringify(createSyntheticRecord(2, row, { status: "failed" }))}\n`,
    "utf8",
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    runPublicCorpusImport({ resumeManifestPath: manifestPath }, { fetchPage: async () => [] }),
    /multiple outcomes/,
  );
});

test("runPublicCorpusImport rejects recovered tails that exceed a page across ledgers", async () => {
  const run = await createFailedAfterFirstPageRun({
    runId: "tail-overflow-run",
    tempPrefix: "aperture-corpus-run-tail-overflow-",
    failureMessage: "checkpoint before overflow",
    maxRows: 6,
  });
  const manifest = JSON.parse(await readFile(run.manifestPath, "utf8")) as PublicCorpusRunManifest;
  manifest.status = "running";
  manifest.progress.nextOffset = 2;
  manifest.progress.rowsFetched = 2;
  manifest.progress.rowsImported = 2;
  delete manifest.termination;

  await writeFile(
    run.recordsPath,
    `${await readFile(run.recordsPath, "utf8")}${JSON.stringify(createSyntheticRecord(2, createTraceCommonsRow(2)))}\n${JSON.stringify(createSyntheticRecord(3, createTraceCommonsRow(3)))}\n`,
    "utf8",
  );
  await writeFile(
    run.errorsPath,
    `${JSON.stringify(createSyntheticRecord(4, createTraceCommonsRow(4), { status: "failed" }))}\n`,
    "utf8",
  );
  await writeFile(run.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    runPublicCorpusImport({ resumeManifestPath: run.manifestPath }, { fetchPage: async () => [] }),
    /ledger digest mismatch/,
  );
});

test("runPublicCorpusImport rejects non-contiguous recovered ledger tails", async () => {
  const run = await createFailedAfterFirstPageRun({
    runId: "tail-gap-run",
    tempPrefix: "aperture-corpus-run-tail-gap-",
    failureMessage: "checkpoint before gap",
  });
  const manifest = JSON.parse(await readFile(run.manifestPath, "utf8")) as PublicCorpusRunManifest;
  manifest.status = "running";
  manifest.progress.nextOffset = 2;
  manifest.progress.rowsFetched = 2;
  manifest.progress.rowsImported = 2;
  delete manifest.termination;

  await writeFile(
    run.recordsPath,
    `${await readFile(run.recordsPath, "utf8")}${JSON.stringify(createSyntheticRecord(3, createTraceCommonsRow(3)))}\n`,
    "utf8",
  );
  await writeFile(run.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    runPublicCorpusImport({ resumeManifestPath: run.manifestPath }, { fetchPage: async () => [] }),
    /ledger digest mismatch/,
  );
});

test("runPublicCorpusImport dedupes exact ledger duplicates during resume", async () => {
  const run = await createFailedAfterFirstPageRun({
    runId: "exact-duplicate-run",
    tempPrefix: "aperture-corpus-run-exact-duplicate-",
    failureMessage: "checkpoint before exact duplicate",
  });
  const originalRecords = await readFile(run.recordsPath, "utf8");
  const duplicateLine = originalRecords.trim().split("\n").at(-1);
  assert.ok(duplicateLine);
  await writeFile(run.recordsPath, `${originalRecords}${duplicateLine}\n`, "utf8");

  const calls: TraceCommonsPageRequest[] = [];
  const resumed = await runPublicCorpusImport(
    { resumeManifestPath: run.manifestPath },
    {
      fetchPage: async (request) => {
        calls.push(request);
        return createTraceCommonsRows(request.offset, request.limit);
      },
    },
  );

  assert.deepEqual(
    calls.map((call) => call.offset),
    [2],
  );
  assert.equal(resumed.manifest.progress.rowsImported, 4);
  assert.equal((await readFile(run.recordsPath, "utf8")).trim().split("\n").length, 4);
});

test("runPublicCorpusImport rejects same-offset non-identical ledger entries", async () => {
  const run = await createFailedAfterFirstPageRun({
    runId: "same-offset-conflict-run",
    tempPrefix: "aperture-corpus-run-same-offset-conflict-",
    failureMessage: "checkpoint before same offset conflict",
  });
  const originalRecords = await readFile(run.recordsPath, "utf8");
  const conflictingRecord = JSON.parse(originalRecords.trim().split("\n").at(-1)!) as Record<
    string,
    unknown
  >;
  conflictingRecord.bundlePath = "/tmp/different-bundle-path.json";
  await writeFile(
    run.recordsPath,
    `${originalRecords}${JSON.stringify(conflictingRecord)}\n`,
    "utf8",
  );

  await assert.rejects(
    runPublicCorpusImport({ resumeManifestPath: run.manifestPath }, { fetchPage: async () => [] }),
    /multiple outcomes/,
  );
});

test("runPublicCorpusImport rejects invalid exported plan options", async () => {
  await assert.rejects(() => runPublicCorpusImport({ offset: -1 }), /offset/);
  await assert.rejects(() => runPublicCorpusImport({ maxRows: 1.5 }), /max-rows/);
  await assert.rejects(() => runPublicCorpusImport({ maxResponseBytes: 0 }), /max-response-bytes/);
  await assert.rejects(
    () => runPublicCorpusImport({ maxResponseBytes: MAX_PUBLIC_CORPUS_RESPONSE_BYTES + 1 }),
    /max-response-bytes/,
  );
  await assert.rejects(() => runPublicCorpusImport({ maxRetries: -1 }), /max-retries/);
  await assert.rejects(
    () => runPublicCorpusImport({ offset: Number.MAX_SAFE_INTEGER, maxRows: 1 }),
    /offset plus --max-rows/,
  );
});

test("manifest validation rejects impossible progress relationships", async () => {
  const result = await runPublicCorpusImport({
    plan: true,
    exportedAt: "2026-03-28T00:00:00.000Z",
  });
  const manifest = result.manifest;
  manifest.progress.pagesAttempted = 0;
  manifest.progress.pagesCompleted = 99;
  manifest.progress.rowsFetched = 0;
  manifest.progress.rowsImported = 99;

  assert.equal(isPublicCorpusRunManifest(manifest), false);
});

test("manifest validation rejects unsafe integers and impossible cursor advance", async () => {
  const result = await runPublicCorpusImport({
    plan: true,
    exportedAt: "2026-03-28T00:00:00.000Z",
  });
  const unsafePlan = JSON.parse(JSON.stringify(result.manifest)) as PublicCorpusRunManifest;
  unsafePlan.plan.maxRows = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(isPublicCorpusRunManifest(unsafePlan), false);

  const unsafeResponseBytes = JSON.parse(
    JSON.stringify(result.manifest),
  ) as PublicCorpusRunManifest;
  unsafeResponseBytes.plan.maxResponseBytes = MAX_PUBLIC_CORPUS_RESPONSE_BYTES + 1;
  assert.equal(isPublicCorpusRunManifest(unsafeResponseBytes), false);

  const unsafeUpperBound = JSON.parse(JSON.stringify(result.manifest)) as PublicCorpusRunManifest;
  unsafeUpperBound.plan.startOffset = Number.MAX_SAFE_INTEGER;
  unsafeUpperBound.plan.maxRows = 1;
  assert.equal(isPublicCorpusRunManifest(unsafeUpperBound), false);

  const impossibleProgress = JSON.parse(JSON.stringify(result.manifest)) as PublicCorpusRunManifest;
  impossibleProgress.progress.nextOffset = impossibleProgress.plan.startOffset + 1;
  impossibleProgress.progress.rowsFetched = 0;
  assert.equal(isPublicCorpusRunManifest(impossibleProgress), false);
});

test("runPublicCorpusImport rejects plan-changing resume options", async () => {
  await assert.rejects(
    runPublicCorpusImport({
      resumeManifestPath: "/tmp/aperture-manifest.json",
      plan: true,
    }),
    /resume cannot be combined/i,
  );
});

test("runPublicCorpusImport plan mode performs no network or writes", async () => {
  const result = await runPublicCorpusImport(
    {
      plan: true,
      maxRows: 10,
      pageSize: 5,
      maxResponseBytes: 12_345_678,
      runtimeRoot: "/srv/aperture-lab",
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    {
      fetchPage: async () => {
        throw new Error("plan mode should not fetch");
      },
    },
  );

  assert.equal(result.manifest.status, "planned");
  assert.equal(result.manifest.progress.rowsFetched, 0);
  assert.equal(result.manifest.plan.maxResponseBytes, 12_345_678);
  assert.equal(result.manifest.runtime.runtimeRoot, "/srv/aperture-lab");
  assert.equal(result.manifestPath, undefined);
  assert.equal(result.bundlePaths.length, 0);
});

test("parseCorpusRunArgs allows resume plus json without runner overrides", () => {
  const options = parseCorpusRunArgs(["--resume", "/tmp/manifest.json", "--json"]);
  assert.equal(options.resumeManifestPath, "/tmp/manifest.json");
  assert.equal(options.json, true);
  assert.equal(options.split, undefined);
});

test("parseCorpusRunArgs accepts explicit response byte budget", () => {
  const options = parseCorpusRunArgs(["--max-response-bytes", "12345678"]);
  assert.equal(options.maxResponseBytes, 12_345_678);
});

test("parseCorpusRunArgs accepts managed DataClaw corpus runs", () => {
  const options = parseCorpusRunArgs(["--dataset", "dataclaw", "--split", "train"]);
  assert.equal(options.dataset, "dataclaw");
  assert.equal(options.split, "train");
});

test("runCorpusRun CLI resume options can be passed to the runner", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-corpus-run-cli-resume-"));
  const runtimeRoot = path.join(directory, "runtime");
  const initial = await runPublicCorpusImport(
    {
      maxRows: 1,
      pageSize: 1,
      runtimeRoot,
      runId: "cli-resume",
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    { fetchPage: async () => [] },
  );
  const manifest = initial.manifest;
  manifest.status = "failed";
  delete manifest.completedAt;
  await writePublicCorpusRunManifestAtomic(manifest);

  const output = await captureStdout(async () => {
    await runCorpusRunCli(["--resume", initial.manifestPath!, "--json"], {
      fetchPage: async () => [],
    });
  });
  const resumed = JSON.parse(output) as { manifest: PublicCorpusRunManifest };
  assert.equal(resumed.manifest.status, "completed");
});

test("renderPublicCorpusRunMarkdown includes source posture", async () => {
  const result = await runPublicCorpusImport(
    {
      maxRows: 1,
      pageSize: 1,
      dryRun: true,
      exportedAt: "2026-03-28T00:00:00.000Z",
    },
    {
      fetchPage: async () => [],
    },
  );

  const markdown = renderPublicCorpusRunMarkdown(result.manifest);
  assert.match(markdown, /trace-commons\/train/);
  assert.match(markdown, /public_anonymized_best_effort/);
  assert.match(markdown, /review_required_before_promotion/);
});

test("fetchJsonWithPolicy retries retryable responses", async () => {
  const sleeps: number[] = [];
  const responses = [
    new Response("", {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "retry-after": "0" },
    }),
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  ];

  const payload = await fetchJsonWithPolicy("https://example.test/rows", {
    timeoutMs: 1000,
    maxRetries: 1,
    fetch: async () => responses.shift()!,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
    },
  });

  assert.deepEqual(payload, { ok: true });
  assert.deepEqual(sleeps, [0]);
});

test("fetchJsonWithPolicy bounds response bodies", async () => {
  let cancelled = false;
  await assert.rejects(
    fetchJsonWithPolicy("https://example.test/rows", {
      timeoutMs: 1000,
      maxRetries: 0,
      maxBytes: 4,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ too: "large" })));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200 },
        ),
    }),
    /exceeded 4 bytes/,
  );
  assert.equal(cancelled, true);
});

test("fetchJsonWithPolicy aborts stalled response bodies", async () => {
  await assert.rejects(
    fetchJsonWithPolicy("https://example.test/rows", {
      timeoutMs: 1,
      maxRetries: 0,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start() {
              // Leave the body open until AbortController cancels the reader.
            },
          }),
          { status: 200 },
        ),
    }),
    /aborted/i,
  );
});

test("parseCorpusRunArgs rejects loose integers, missing values, and resume overrides", () => {
  assert.throws(() => parseCorpusRunArgs(["--max-rows", "10x"]), /positive integer/);
  assert.throws(() => parseCorpusRunArgs(["--page-size", "1.5"]), /positive integer/);
  assert.throws(() => parseCorpusRunArgs(["--max-response-bytes", "1.5"]), /positive integer/);
  assert.throws(() => parseCorpusRunArgs(["--runtime-root"]), /requires a value/);
  assert.throws(
    () => parseCorpusRunArgs(["--resume", "/tmp/manifest.json", "--plan"]),
    /cannot be combined/,
  );
});

async function createFailedAfterFirstPageRun(input: {
  runId: string;
  tempPrefix: string;
  failureMessage: string;
  maxRows?: number;
}): Promise<{
  runtimeRoot: string;
  manifestPath: string;
  recordsPath: string;
  errorsPath: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), input.tempPrefix));
  const runtimeRoot = path.join(directory, "runtime");
  await assert.rejects(
    runPublicCorpusImport(
      {
        maxRows: input.maxRows ?? 4,
        pageSize: 2,
        runtimeRoot,
        runId: input.runId,
        exportedAt: "2026-03-28T00:00:00.000Z",
      },
      {
        fetchPage: async (request) => {
          if (request.offset === 2) throw new Error(input.failureMessage);
          return createTraceCommonsRows(request.offset, request.limit);
        },
      },
    ),
    new RegExp(input.failureMessage),
  );

  const runRoot = path.join(runtimeRoot, "corpus-runs", input.runId);
  return {
    runtimeRoot,
    manifestPath: path.join(runRoot, "manifest.json"),
    recordsPath: path.join(runRoot, "records.jsonl"),
    errorsPath: path.join(runRoot, "errors.jsonl"),
  };
}

function createTraceCommonsRows(offset: number, limit: number): TraceCommonsRow[] {
  return Array.from({ length: limit }, (_, index) => createTraceCommonsRow(offset + index));
}

function createDataclawRows(offset: number, limit: number): DataclawRow[] {
  return Array.from({ length: limit }, (_, index) => createDataclawRow(offset + index));
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
              arguments: '{"command":"pnpm test parser"}',
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

function createSyntheticRecord(
  offset: number,
  row: TraceCommonsRow,
  options: { status?: "written" | "failed" } = {},
): Record<string, unknown> {
  return {
    offset,
    rowIndex: 0,
    recordId: `${row.harness}:${row.session_id}`,
    sourceIdentity: `${row.harness}/${row.session_id}`,
    rowDigest: digestJsonValue(row),
    status: options.status ?? "written",
    sessionId: `public:trace-commons:${row.harness}:${row.session_id}`,
    bundlePath: `/tmp/bundle-${offset}.json`,
    bundleDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    canonicalSessionDigest:
      "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  };
}

async function captureStdout(action: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    chunks.push(String(chunk));
    const callback = args.find((arg): arg is (error?: Error) => void => typeof arg === "function");
    callback?.();
    return true;
  }) as typeof process.stdout.write;
  try {
    await action();
  } finally {
    process.stdout.write = originalWrite;
  }
  return chunks.join("");
}
