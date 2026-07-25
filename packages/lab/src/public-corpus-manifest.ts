import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { PUBLIC_CORPUS_RUN_SCHEMA_VERSION } from "./artifact-versions.js";
import { digestKernelCanonicalJson } from "./kernel-canonical-json.js";
import {
  DEFAULT_TRACE_COMMONS_SPLIT,
  HUGGINGFACE_TRACE_COMMONS_AGENT_TRACES_DATASET,
  TRACE_COMMONS_AGENT_TRACES_DATASET,
  type TraceCommonsSplit,
} from "./public-trajectories-types.js";
import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";

export const TRACE_COMMONS_DATASET_URL =
  "https://huggingface.co/datasets/trace-commons/agent-traces" as const;

export const DEFAULT_PUBLIC_CORPUS_RUNS_DIR = path.join(DEFAULT_LAB_RUNTIME_ROOT, "corpus-runs");
export const DEFAULT_PUBLIC_CORPUS_BUNDLES_DIR = path.join(
  DEFAULT_LAB_RUNTIME_ROOT,
  "bundles",
  "public",
);
export const DEFAULT_PUBLIC_CORPUS_PAGE_SIZE = 25 as const;
export const DEFAULT_PUBLIC_CORPUS_MAX_ROWS = 100 as const;
export const DEFAULT_PUBLIC_CORPUS_TIMEOUT_SECONDS = 30 as const;
export const DEFAULT_PUBLIC_CORPUS_MAX_RETRIES = 2 as const;
export const DEFAULT_PUBLIC_CORPUS_MAX_RESPONSE_BYTES = 67_108_864 as const;
export const MAX_PUBLIC_CORPUS_RESPONSE_BYTES = 134_217_728 as const;

export type PublicCorpusDataset = "trace-commons";
export type PublicCorpusExistingPolicy = "verify" | "error" | "skip";
export type PublicCorpusRunStatus = "planned" | "running" | "completed" | "failed" | "cancelled";
export type PublicCorpusRecordStatus =
  | "prepared"
  | "written"
  | "verified_existing"
  | "skipped_existing"
  | "failed";

export type PublicCorpusRunPlan = {
  dataset: PublicCorpusDataset;
  split: TraceCommonsSplit;
  startOffset: number;
  maxRows: number;
  pageSize: number;
  requestTimeoutSeconds: number;
  maxResponseBytes: number;
  maxRetries: number;
  existing: PublicCorpusExistingPolicy;
  mirrorRaw: false;
  dryRun: boolean;
  planOnly: boolean;
};

export type PublicCorpusRunManifest = {
  schemaVersion: typeof PUBLIC_CORPUS_RUN_SCHEMA_VERSION;
  runId: string;
  status: PublicCorpusRunStatus;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  source: {
    kind: "public-trajectory";
    adapter: PublicCorpusDataset;
    dataset: typeof TRACE_COMMONS_AGENT_TRACES_DATASET;
    upstream: typeof HUGGINGFACE_TRACE_COMMONS_AGENT_TRACES_DATASET;
    upstreamUrl: typeof TRACE_COMMONS_DATASET_URL;
    config: "default";
    split: TraceCommonsSplit;
    requestedRevision: "live_rows_api_unpinned";
    resolvedRevision: "live_rows_api_unpinned";
    reproducibility: "digest-verifiable";
  };
  plan: PublicCorpusRunPlan;
  runtime: {
    runtimeRoot: string;
    cwd: string;
    nodeVersion: string;
    importerSchemaVersion: typeof PUBLIC_CORPUS_RUN_SCHEMA_VERSION;
  };
  privacy: {
    classification: "public_anonymized_best_effort";
    redactionPosture: "review_required_before_promotion";
    licenseScope: "dataset_compilation_cc_by_4.0_embedded_content_may_differ";
    rawRetention: "not_mirrored";
  };
  progress: {
    nextOffset: number;
    pagesAttempted: number;
    pagesCompleted: number;
    rowsFetched: number;
    rowsImported: number;
    rowsSkipped: number;
    rowsFailed: number;
    rowsDuplicated: number;
  };
  artifacts: {
    runRoot: string;
    manifestPath: string;
    recordsPath: string;
    errorsPath: string;
    bundleRoot: string;
  };
  integrity: {
    recordsDigest?: `sha256:${string}`;
    errorsDigest?: `sha256:${string}`;
    bundleSetDigest?: `sha256:${string}`;
  };
  termination?: {
    code: string;
    message: string;
  };
};

export type PublicCorpusRecordLedgerEntry = {
  offset: number;
  rowIndex: number;
  recordId: string;
  sourceIdentity: string;
  rowDigest: `sha256:${string}`;
  status: PublicCorpusRecordStatus;
  sessionId?: string;
  bundlePath?: string;
  bundleDigest?: `sha256:${string}`;
  canonicalSessionDigest?: `sha256:${string}`;
  errorCode?: string;
  errorMessage?: string;
};

export type PublicCorpusManifestInput = {
  runId: string;
  createdAt: string;
  runtimeRoot: string;
  runRoot: string;
  bundleRoot: string;
  plan: PublicCorpusRunPlan;
};

export function createInitialPublicCorpusManifest(
  input: PublicCorpusManifestInput,
): PublicCorpusRunManifest {
  const manifestPath = path.join(input.runRoot, "manifest.json");
  return {
    schemaVersion: PUBLIC_CORPUS_RUN_SCHEMA_VERSION,
    runId: input.runId,
    status: input.plan.planOnly ? "planned" : "running",
    createdAt: input.createdAt,
    ...(input.plan.planOnly ? {} : { startedAt: input.createdAt }),
    updatedAt: input.createdAt,
    source: {
      kind: "public-trajectory",
      adapter: "trace-commons",
      dataset: TRACE_COMMONS_AGENT_TRACES_DATASET,
      upstream: HUGGINGFACE_TRACE_COMMONS_AGENT_TRACES_DATASET,
      upstreamUrl: TRACE_COMMONS_DATASET_URL,
      config: "default",
      split: input.plan.split,
      requestedRevision: "live_rows_api_unpinned",
      resolvedRevision: "live_rows_api_unpinned",
      reproducibility: "digest-verifiable",
    },
    plan: input.plan,
    runtime: {
      runtimeRoot: input.runtimeRoot,
      cwd: process.cwd(),
      nodeVersion: process.version,
      importerSchemaVersion: PUBLIC_CORPUS_RUN_SCHEMA_VERSION,
    },
    privacy: {
      classification: "public_anonymized_best_effort",
      redactionPosture: "review_required_before_promotion",
      licenseScope: "dataset_compilation_cc_by_4.0_embedded_content_may_differ",
      rawRetention: "not_mirrored",
    },
    progress: {
      nextOffset: input.plan.startOffset,
      pagesAttempted: 0,
      pagesCompleted: 0,
      rowsFetched: 0,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsFailed: 0,
      rowsDuplicated: 0,
    },
    artifacts: {
      runRoot: input.runRoot,
      manifestPath,
      recordsPath: path.join(input.runRoot, "records.jsonl"),
      errorsPath: path.join(input.runRoot, "errors.jsonl"),
      bundleRoot: input.bundleRoot,
    },
    integrity: {},
  };
}

export function defaultPublicCorpusRunRoot(runtimeRoot: string = DEFAULT_LAB_RUNTIME_ROOT): string {
  return path.join(runtimeRoot, "corpus-runs");
}

export function defaultPublicCorpusBundleRoot(
  runtimeRoot: string = DEFAULT_LAB_RUNTIME_ROOT,
): string {
  return path.join(runtimeRoot, "bundles", "public");
}

export function defaultPublicCorpusRunId(input: {
  createdAt: string;
  startOffset: number;
  maxRows: number;
  pageSize: number;
}): string {
  return safeRunId(
    [
      "trace-commons",
      DEFAULT_TRACE_COMMONS_SPLIT,
      `o${input.startOffset}`,
      `m${input.maxRows}`,
      `p${input.pageSize}`,
      safeTimestamp(input.createdAt),
    ].join("-"),
  );
}

export function renderPublicCorpusRunMarkdown(manifest: PublicCorpusRunManifest): string {
  return `${[
    "# Public Corpus Run",
    "",
    `Run: ${manifest.runId}`,
    `Status: ${manifest.status}`,
    `Dataset: ${manifest.plan.dataset}/${manifest.plan.split}`,
    `Rows: ${manifest.progress.rowsImported} imported, ${manifest.progress.rowsSkipped} skipped, ${manifest.progress.rowsFailed} failed`,
    `Next offset: ${manifest.progress.nextOffset}`,
    `Runtime root: ${manifest.runtime.runtimeRoot}`,
    "",
    "## Source",
    "",
    `- Upstream: ${manifest.source.upstream}`,
    `- Upstream URL: ${manifest.source.upstreamUrl}`,
    `- Reproducibility: ${manifest.source.reproducibility}`,
    `- Response byte budget: ${manifest.plan.maxResponseBytes}`,
    `- Privacy: ${manifest.privacy.classification}; ${manifest.privacy.redactionPosture}`,
    `- License scope: ${manifest.privacy.licenseScope}`,
    "",
    "## Artifacts",
    "",
    `- Manifest: ${manifest.artifacts.manifestPath}`,
    `- Records: ${manifest.artifacts.recordsPath}`,
    `- Errors: ${manifest.artifacts.errorsPath}`,
    `- Bundles: ${manifest.artifacts.bundleRoot}`,
    "",
    "## Next Command",
    "",
    "```bash",
    `pnpm lab:fstop:review --dataset trace-commons --split ${manifest.plan.split} --offset ${manifest.plan.startOffset} --limit ${manifest.plan.pageSize}`,
    "```",
  ].join("\n")}\n`;
}

export async function writePublicCorpusRunManifestAtomic(
  manifest: PublicCorpusRunManifest,
): Promise<void> {
  await writeJsonAtomic(manifest.artifacts.manifestPath, manifest);
}

export async function writePublicCorpusRunMarkdownAtomic(
  manifest: PublicCorpusRunManifest,
): Promise<void> {
  await writeTextAtomic(
    path.join(manifest.artifacts.runRoot, "report.md"),
    renderPublicCorpusRunMarkdown(manifest),
  );
}

export async function appendPublicCorpusRecord(
  filePath: string,
  record: PublicCorpusRecordLedgerEntry,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, value, "utf8");
  await rename(tempPath, filePath);
}

export async function digestFileIfPresent(
  filePath: string,
): Promise<`sha256:${string}` | undefined> {
  try {
    return digestText(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

export function digestJsonValue(value: unknown): `sha256:${string}` {
  return digestKernelCanonicalJson(toDigestableJson(value));
}

export function digestText(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function safeRunId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "trace-commons-run";
}

function toDigestableJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toDigestableJson(item));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined && typeof entry !== "function" && typeof entry !== "symbol") {
        output[key] = toDigestableJson(entry);
      }
    }
    return output;
  }
  return null;
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
