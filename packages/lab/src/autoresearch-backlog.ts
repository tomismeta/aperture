import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AutoresearchProposalCodeRecommendation,
  AutoresearchProposalIntentStatement,
} from "./autoresearch-proposal.js";
import type {
  AutoresearchRunnerProposalSnapshot,
  AutoresearchRunnerRetainedAttempt,
  AutoresearchRunnerRun,
} from "./autoresearch-runner.js";
import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";

export const AUTORESEARCH_RETAINED_BACKLOG_SCHEMA_VERSION = 1 as const;

export const DEFAULT_AUTORESEARCH_RETAINED_BACKLOG_DIR = path.join(
  DEFAULT_LAB_RUNTIME_ROOT,
  "results",
  "autoresearch",
  "backlog",
);

export type AutoresearchRetainedBacklogOccurrence = {
  generatedAt: string;
  provider: string;
  offset: number;
  limit: number;
  status: string;
  retainedOutcome: string;
  actionableCount?: number;
  selectedSignalCount?: number;
  promotedCaseCount?: number;
  optimizerStatus?: string;
  runPath?: string;
  runMarkdownPath?: string;
  proposalPath?: string;
  batchReportPath?: string;
  optimizerRunPath?: string;
  patchPath?: string;
};

export type AutoresearchRetainedBacklogEntry = {
  key: string;
  focusArea: string;
  owner: string;
  apertureValue: string;
  expectedValue: string;
  targets: readonly string[];
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  runCount: number;
  patchAttemptCount: number;
  gateBlockedCount: number;
  optimizerCleanCount: number;
  latestRetainedOutcome: string;
  latestStatus: string;
  latestProvider: string;
  latestIntentStatements: readonly AutoresearchProposalIntentStatement[];
  latestCodeRecommendations: readonly AutoresearchProposalCodeRecommendation[];
  latestOptimizerSummary?: AutoresearchRunnerProposalSnapshot["optimizer"];
  examples: readonly {
    sessionId: string;
    stepIndex: number;
    stepLabel?: string;
    confidence: AutoresearchRunnerProposalSnapshot["signals"][number]["examples"][number]["confidence"];
    rationale?: string;
  }[];
  recentOccurrences: readonly AutoresearchRetainedBacklogOccurrence[];
};

export type AutoresearchRetainedBacklog = {
  schemaVersion: typeof AUTORESEARCH_RETAINED_BACKLOG_SCHEMA_VERSION;
  generatedAt: string;
  entryCount: number;
  totalOccurrences: number;
  entries: readonly AutoresearchRetainedBacklogEntry[];
};

export function defaultAutoresearchRetainedBacklogPath(
  directory = DEFAULT_AUTORESEARCH_RETAINED_BACKLOG_DIR,
): string {
  return path.join(directory, "autoresearch-retained-backlog.json");
}

export function defaultAutoresearchRetainedBacklogMarkdownPath(
  filePath: string,
): string {
  return filePath.replace(/\.json$/i, ".md");
}

export async function loadAutoresearchRetainedBacklog(
  filePath: string,
): Promise<AutoresearchRetainedBacklog | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as AutoresearchRetainedBacklog;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function writeAutoresearchRetainedBacklog(
  filePath: string,
  backlog: AutoresearchRetainedBacklog,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(backlog, null, 2)}\n`, "utf8");
}

export async function updateAutoresearchRetainedBacklog(options: {
  run: AutoresearchRunnerRun;
  runPath?: string;
  runMarkdownPath?: string;
  outputPath?: string;
}): Promise<{
  backlog: AutoresearchRetainedBacklog;
  backlogPath: string;
  backlogMarkdownPath: string;
}> {
  const envPath = process.env.APERTURE_AUTORESEARCH_RETAINED_BACKLOG_PATH?.trim();
  const backlogPath = path.resolve(
    options.outputPath ?? envPath ?? defaultAutoresearchRetainedBacklogPath(),
  );
  const backlogMarkdownPath = defaultAutoresearchRetainedBacklogMarkdownPath(backlogPath);
  const existing = await loadAutoresearchRetainedBacklog(backlogPath);
  const entries = new Map(
    (existing?.entries ?? []).map((entry) => [entry.key, entry] as const),
  );
  const seenKeysThisRun = new Set<string>();

  for (const attempt of options.run.retainedAttempts ?? []) {
    const key = deriveRetainedAttemptKey(attempt);
    const primarySignal = attempt.snapshot.signals[0];
    const current = entries.get(key);
    const latest = !current || options.run.generatedAt >= current.lastSeenAt;
    const occurrence = createOccurrence({
      attempt,
      run: options.run,
      ...(options.runPath ? { runPath: options.runPath } : {}),
      ...(options.runMarkdownPath ? { runMarkdownPath: options.runMarkdownPath } : {}),
    });

    const merged: AutoresearchRetainedBacklogEntry = {
      key,
      focusArea: primarySignal?.focusArea ?? attempt.snapshot.intentStatements[0]?.focusArea ?? "unknown",
      owner: primarySignal?.owner ?? attempt.snapshot.intentStatements[0]?.owner ?? "unknown",
      apertureValue: formatSemanticValue(
        primarySignal?.apertureValue ?? attempt.snapshot.intentStatements[0]?.apertureValue,
      ),
      expectedValue: formatSemanticValue(
        primarySignal?.expectedValue ?? attempt.snapshot.intentStatements[0]?.expectedValue,
      ),
      targets: dedupeStrings([
        ...(current?.targets ?? []),
        ...(primarySignal?.targets ?? []),
        ...collectIntentTargets(attempt.snapshot.intentStatements),
      ]),
      firstSeenAt: current?.firstSeenAt ?? options.run.generatedAt,
      lastSeenAt: latest ? options.run.generatedAt : current.lastSeenAt,
      occurrenceCount: (current?.occurrenceCount ?? 0) + 1,
      runCount: (current?.runCount ?? 0) + (seenKeysThisRun.has(key) ? 0 : 1),
      patchAttemptCount:
        (current?.patchAttemptCount ?? 0)
        + Number(attempt.retainedOutcome === "no_change_patch_attempted" || Boolean(attempt.patch)),
      gateBlockedCount: (current?.gateBlockedCount ?? 0) + Number(attempt.retainedOutcome === "gate_blocked"),
      optimizerCleanCount: (current?.optimizerCleanCount ?? 0) + Number(attempt.retainedOutcome === "optimizer_clean"),
      latestRetainedOutcome: latest ? attempt.retainedOutcome : current.latestRetainedOutcome,
      latestStatus: latest ? attempt.status : current.latestStatus,
      latestProvider: latest ? options.run.provider : current.latestProvider,
      latestIntentStatements:
        latest || !current
          ? attempt.snapshot.intentStatements.slice(0, 3)
          : current.latestIntentStatements,
      latestCodeRecommendations:
        latest || !current
          ? attempt.snapshot.codeRecommendations.slice(0, 3)
          : current.latestCodeRecommendations,
      ...(latest && attempt.snapshot.optimizer
        ? { latestOptimizerSummary: attempt.snapshot.optimizer }
        : current?.latestOptimizerSummary
          ? { latestOptimizerSummary: current.latestOptimizerSummary }
          : {}),
      examples: mergeExamples(current?.examples ?? [], primarySignal?.examples ?? []),
      recentOccurrences: mergeOccurrences(current?.recentOccurrences ?? [], occurrence),
    };

    entries.set(key, merged);
    seenKeysThisRun.add(key);
  }

  const sortedEntries = [...entries.values()].sort(compareBacklogEntries);
  const backlog: AutoresearchRetainedBacklog = {
    schemaVersion: AUTORESEARCH_RETAINED_BACKLOG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    entryCount: sortedEntries.length,
    totalOccurrences: sortedEntries.reduce((sum, entry) => sum + entry.occurrenceCount, 0),
    entries: sortedEntries,
  };

  await writeAutoresearchRetainedBacklog(backlogPath, backlog);
  await mkdir(path.dirname(backlogMarkdownPath), { recursive: true });
  await writeFile(backlogMarkdownPath, renderAutoresearchRetainedBacklogMarkdown(backlog), "utf8");

  return {
    backlog,
    backlogPath,
    backlogMarkdownPath,
  };
}

export function renderAutoresearchRetainedBacklogMarkdown(
  backlog: AutoresearchRetainedBacklog,
): string {
  const lines: string[] = [
    "# Aperture Lab Proposal Brief",
    "",
    `Generated: ${backlog.generatedAt}`,
    `Retained proposals: ${backlog.entryCount}`,
    `Total retained occurrences: ${backlog.totalOccurrences}`,
  ];

  if (backlog.entries.length === 0) {
    lines.push(
      "",
      "No retained near-miss proposals recorded yet.",
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "",
    "This file compiles the strongest non-winning proposal ideas from F-Stop runs.",
    "Each entry is a pattern the reviewer thought mattered, the optimizer attempted to address, but the deterministic gates did not accept yet.",
    "",
    "## Quick Summary",
    "",
  );

  for (const [index, entry] of backlog.entries.entries()) {
    const latestIntent = entry.latestIntentStatements[0];
    const latestRecommendation = entry.latestCodeRecommendations[0];
    const latestOptimizer = entry.latestOptimizerSummary;
    const example = entry.examples[0];
    const summaryLine = latestIntent?.statement
      ?? latestRecommendation?.summary
      ?? `${entry.focusArea} (${entry.owner}) ${entry.apertureValue} -> ${entry.expectedValue}`;
    lines.push(
      `${index + 1}. ${summaryLine}`,
    );
    lines.push(
      `   occurrences: ${entry.occurrenceCount} across ${entry.runCount} run(s); latest outcome ${entry.latestProvider} ${entry.latestStatus} (${entry.latestRetainedOutcome})`,
    );
  }

  for (const [index, entry] of backlog.entries.entries()) {
    const latestIntent = entry.latestIntentStatements[0];
    const latestRecommendation = entry.latestCodeRecommendations[0];
    const latestOptimizer = entry.latestOptimizerSummary;
    const example = entry.examples[0];
    const latestOccurrence = entry.recentOccurrences[0];

    lines.push(
      "",
      `## Proposal ${index + 1}: ${entry.focusArea} (${entry.owner}) ${entry.apertureValue} -> ${entry.expectedValue}`,
      "",
      "**Observed Pattern**",
      "",
      latestIntent?.statement
        ?? latestRecommendation?.summary
        ?? `Repeated ${entry.focusArea} drift from ${entry.apertureValue} to ${entry.expectedValue}.`,
      "",
      "**What The Change Would Do**",
      "",
      latestRecommendation?.summary
        ?? "The run retained the intent, but did not produce a concrete code recommendation yet.",
      "",
      "**Why This Is Still On The List**",
      "",
      `- Seen ${entry.occurrenceCount} time(s) across ${entry.runCount} run(s).`,
      `- Latest outcome: ${entry.latestProvider} ${entry.latestStatus} (${entry.latestRetainedOutcome}).`,
      `- Patch attempts so far: ${entry.patchAttemptCount}.`,
      `- Gate-blocked attempts: ${entry.gateBlockedCount}.`,
      `- Optimizer-clean attempts: ${entry.optimizerCleanCount}.`,
    );

    if (entry.targets.length > 0) {
      lines.push("", "**Targets**", "", ...entry.targets.map((target) => `- ${target}`));
    }

    if (example) {
      lines.push(
        "",
        "**Example Evidence**",
        "",
        `- Session: ${example.sessionId}`,
        `- Step: ${example.stepIndex}${example.stepLabel ? ` (${example.stepLabel})` : ""}`,
        `- Confidence: ${example.confidence}`,
        ...(example.rationale ? [`- Why the reviewer cared: ${example.rationale}`] : []),
      );
    }

    if (latestOptimizer) {
      lines.push(
        "",
        "**Latest Optimizer Result**",
        "",
        `- Status: ${latestOptimizer.status}`,
        `- Mismatches: ${latestOptimizer.beforeMismatchCount} -> ${latestOptimizer.afterMismatchCount}`,
        `- Invariant mismatches: ${latestOptimizer.beforeInvariantMismatchCount} -> ${latestOptimizer.afterInvariantMismatchCount}`,
        `- Changed files: ${latestOptimizer.changedFiles.length > 0 ? latestOptimizer.changedFiles.join(", ") : "none"}`,
        `- Disallowed files: ${latestOptimizer.disallowedFiles.length > 0 ? latestOptimizer.disallowedFiles.join(", ") : "none"}`,
        ...(latestOptimizer.judgmentBattle !== undefined
          ? [`- judgment:battle: ${latestOptimizer.judgmentBattle ? "pass" : "fail"}`]
          : []),
        ...(latestOptimizer.releaseCheck !== undefined
          ? [`- release:check: ${latestOptimizer.releaseCheck ? "pass" : "fail"}`]
          : []),
        ...(latestOptimizer.patchPath ? [`- Patch: ${latestOptimizer.patchPath}`] : []),
      );
    }

    if (latestOccurrence) {
      lines.push(
        "",
        "**Latest Run Artifacts**",
        "",
        ...(latestOccurrence.runMarkdownPath ? [`- Run review: ${latestOccurrence.runMarkdownPath}`] : []),
        ...(latestOccurrence.runPath ? [`- Run JSON: ${latestOccurrence.runPath}`] : []),
        ...(latestOccurrence.proposalPath ? [`- Proposal JSON: ${latestOccurrence.proposalPath}`] : []),
        ...(latestOccurrence.batchReportPath ? [`- Batch report: ${latestOccurrence.batchReportPath}`] : []),
        ...(latestOccurrence.optimizerRunPath ? [`- Optimizer run: ${latestOccurrence.optimizerRunPath}`] : []),
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function deriveRetainedAttemptKey(
  attempt: AutoresearchRunnerRetainedAttempt,
): string {
  const primarySignal = attempt.snapshot.signals[0];
  if (primarySignal?.signature) {
    return normalizeSignalSignature(primarySignal.signature);
  }
  if (primarySignal) {
    return [
      "signal",
      primarySignal.owner,
      primarySignal.focusArea,
      formatSemanticValue(primarySignal.apertureValue),
      formatSemanticValue(primarySignal.expectedValue),
      [...primarySignal.targets].sort().join(","),
    ].join("|");
  }

  const intent = attempt.snapshot.intentStatements[0];
  if (intent) {
    return [
      "intent",
      intent.owner,
      intent.focusArea,
      formatSemanticValue(intent.apertureValue),
      formatSemanticValue(intent.expectedValue),
      [...intent.targets].sort().join(","),
    ].join("|");
  }

  return [
    "retained",
    attempt.status,
    attempt.retainedOutcome,
    String(attempt.offset),
    String(attempt.limit),
  ].join("|");
}

function createOccurrence(options: {
  attempt: AutoresearchRunnerRetainedAttempt;
  run: AutoresearchRunnerRun;
  runPath?: string;
  runMarkdownPath?: string;
}): AutoresearchRetainedBacklogOccurrence {
  const { attempt, run } = options;
  return {
    generatedAt: run.generatedAt,
    provider: run.provider,
    offset: attempt.offset,
    limit: attempt.limit,
    status: attempt.status,
    retainedOutcome: attempt.retainedOutcome,
    ...(attempt.actionableCount !== undefined ? { actionableCount: attempt.actionableCount } : {}),
    ...(attempt.selectedSignalCount !== undefined ? { selectedSignalCount: attempt.selectedSignalCount } : {}),
    ...(attempt.promotedCaseCount !== undefined ? { promotedCaseCount: attempt.promotedCaseCount } : {}),
    ...(attempt.optimizerStatus ? { optimizerStatus: attempt.optimizerStatus } : {}),
    ...(options.runPath ? { runPath: options.runPath } : {}),
    ...(options.runMarkdownPath ? { runMarkdownPath: options.runMarkdownPath } : {}),
    ...(attempt.proposal ? { proposalPath: attempt.proposal } : {}),
    ...(attempt.batch ? { batchReportPath: attempt.batch } : {}),
    ...(attempt.optimizer ? { optimizerRunPath: attempt.optimizer } : {}),
    ...(attempt.patch ? { patchPath: attempt.patch } : {}),
  };
}

function collectIntentTargets(
  intents: readonly AutoresearchProposalIntentStatement[],
): string[] {
  return dedupeStrings(intents.flatMap((intent) => intent.targets));
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function mergeExamples(
  existing: readonly AutoresearchRetainedBacklogEntry["examples"][number][],
  incoming: readonly AutoresearchRunnerProposalSnapshot["signals"][number]["examples"][number][],
  limit = 5,
): AutoresearchRetainedBacklogEntry["examples"] {
  const merged = new Map<string, AutoresearchRetainedBacklogEntry["examples"][number]>();
  for (const example of [...incoming, ...existing]) {
    const key = `${example.sessionId}:${example.stepIndex}`;
    if (!merged.has(key)) {
      merged.set(key, example);
    }
  }
  return [...merged.values()].slice(0, limit);
}

function mergeOccurrences(
  existing: readonly AutoresearchRetainedBacklogOccurrence[],
  incoming: AutoresearchRetainedBacklogOccurrence,
  limit = 10,
): AutoresearchRetainedBacklogEntry["recentOccurrences"] {
  const merged = new Map<string, AutoresearchRetainedBacklogOccurrence>();
  for (const occurrence of [incoming, ...existing]) {
    const key = [
      occurrence.generatedAt,
      occurrence.provider,
      occurrence.offset,
      occurrence.limit,
      occurrence.status,
      occurrence.retainedOutcome,
    ].join("|");
    if (!merged.has(key)) {
      merged.set(key, occurrence);
    }
  }
  return [...merged.values()].slice(0, limit);
}

function compareBacklogEntries(
  left: AutoresearchRetainedBacklogEntry,
  right: AutoresearchRetainedBacklogEntry,
): number {
  return (
    right.occurrenceCount - left.occurrenceCount
    || right.runCount - left.runCount
    || right.patchAttemptCount - left.patchAttemptCount
    || right.lastSeenAt.localeCompare(left.lastSeenAt)
    || left.key.localeCompare(right.key)
  );
}

function formatSemanticValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value == null) {
    return "unknown";
  }
  return String(value);
}

function normalizeSignalSignature(signature: string): string {
  return signature
    .split("|")
    .map((segment) => segment.replace(/^"(.*)"$/, "$1"))
    .join("|");
}
