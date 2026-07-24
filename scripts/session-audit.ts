import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { stderr, stdout } from "node:process";

import {
  auditSessionBundleReplays,
  DEFAULT_SESSION_BUNDLES_DIR,
  loadSessionBundle,
  SESSION_BUNDLE_SCHEMA_VERSION,
  validateSessionBundle,
  type ReplaySessionBundle,
  type SessionReplayAudit,
  type SessionReplayAuditInput,
  type SessionReplayAuditReport,
} from "../packages/lab/src/index.ts";

type CliOptions = {
  bundlePaths: string[];
  directories: string[];
  json: boolean;
};

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const inputs = await loadInputBundles(options);
    const report = auditSessionBundleReplays(inputs);

    emitResult(options.json, report);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    bundlePaths: [],
    directories: [],
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case "--bundle":
        if (!next || next.startsWith("-")) {
          throw new Error("--bundle requires a value");
        }
        options.bundlePaths.push(next);
        index += 1;
        continue;
      case "--dir":
        if (!next || next.startsWith("-")) {
          throw new Error("--dir requires a value");
        }
        options.directories.push(next);
        index += 1;
        continue;
      case "--json":
        options.json = true;
        continue;
      case "--help":
        return printUsageAndExit(printHelp);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function loadInputBundles(options: CliOptions): Promise<SessionReplayAuditInput[]> {
  const bundlePaths = options.bundlePaths.map((bundlePath) => path.resolve(bundlePath));
  const directories = (
    options.directories.length > 0 || bundlePaths.length > 0
      ? options.directories
      : [DEFAULT_SESSION_BUNDLES_DIR]
  ).map((directory) => path.resolve(directory));

  const directInputs = await Promise.all(
    bundlePaths.map(async (bundlePath) => ({
      bundle: await loadSessionBundle(bundlePath),
      path: bundlePath,
    })),
  );
  const directoryInputs = (
    await Promise.all(directories.map((directory) => loadDirectoryBundles(directory)))
  ).flat();

  return [...directInputs, ...directoryInputs].sort(
    (left, right) =>
      left.bundle.sessionId.localeCompare(right.bundle.sessionId) ||
      left.path.localeCompare(right.path),
  );
}

async function loadDirectoryBundles(
  directory: string,
): Promise<Array<{ bundle: ReplaySessionBundle; path: string }>> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }

  const bundles: Array<{ bundle: ReplaySessionBundle; path: string }> = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      bundles.push(...(await loadDirectoryBundles(absolutePath)));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const bundle = await maybeReadSessionBundle(absolutePath);
    if (bundle) {
      bundles.push({ bundle, path: absolutePath });
    }
  }

  return bundles;
}

async function maybeReadSessionBundle(filePath: string): Promise<ReplaySessionBundle | null> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse session bundle at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== SESSION_BUNDLE_SCHEMA_VERSION) {
    return null;
  }

  const bundle = validateSessionBundle(parsed);
  if (!bundle) {
    throw new Error(`Invalid session bundle at ${filePath}`);
  }

  return bundle;
}

function emitResult(json: boolean, report: SessionReplayAuditReport): void {
  if (json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  stdout.write(renderAuditReport(report));
}

function renderAuditReport(report: SessionReplayAuditReport): string {
  const lines = [
    `Audited ${report.summary.totalBundles} session bundle(s).`,
    `Status: candidate=${report.summary.candidateBundles}; inspect=${report.summary.inspectBundles}; observe=${report.summary.observeBundles}; repeatable=${report.summary.repeatableBundles}; replayDrift=${report.summary.repeatabilityDriftedBundles}.`,
    `Fidelity: finalViewDrift=${report.summary.finalViewDriftedBundles}; semanticDrift=${report.summary.semanticDriftedBundles}; decisionDrift=${report.summary.decisionDriftedBundles}; comparableFingerprints=${report.summary.comparableFingerprints}; unavailableFingerprints=${report.summary.unavailableFingerprints}.`,
    `Pressure: ambiguous=${report.summary.ambiguousDecisions}; recovered=${report.summary.ambiguousRecoveries}; lowConfidence=${report.summary.lowConfidenceDecisions}; continuityOverrides=${report.summary.continuityOverrides}; mergedEpisodes=${report.summary.mergedEpisodeUpdates}.`,
  ];

  if (report.duplicateSessionIds.length > 0) {
    lines.push(`Duplicate session ids: ${renderDuplicateGroups(report.duplicateSessionIds)}.`);
  }

  if (report.duplicateInputDigests.length > 0) {
    lines.push(`Duplicate input digests: ${renderDuplicateGroups(report.duplicateInputDigests)}.`);
  }

  if (report.audits.length === 0) {
    lines.push("No session bundles found.");
    return `${lines.join("\n")}\n`;
  }

  for (const audit of report.audits) {
    lines.push("", renderAudit(audit));
  }

  return `${lines.join("\n")}\n`;
}

function renderAudit(audit: SessionReplayAudit): string {
  const fingerprints = audit.fidelity.decisions.fingerprintStatusCounts;
  const semantics = audit.fidelity.semantics.statusCounts;

  return [
    `[${audit.review.status}] ${audit.title} (${audit.sessionId})`,
    `  path=${audit.path ?? "unknown"}`,
    `  coverage=steps:${audit.coverage.steps}, source:${audit.coverage.sourceEvents}, decisions:${audit.coverage.replayedDecisions}, semantics:${audit.coverage.replayedSemanticSnapshots}`,
    `  repeatability=${audit.repeatability.stable ? "stable" : audit.repeatability.driftAreas.join(", ")}; finalView=${audit.fidelity.finalView.status}`,
    `  decisions=fingerprints match:${fingerprints.match}, mismatch:${fingerprints.mismatch}, unavailable:${fingerprints.unavailable}, incompatible:${fingerprints.incompatible_version}; fieldDriftSteps=${renderNumberList(audit.fidelity.decisions.fieldDriftStepIndices)}`,
    `  semantics=match:${semantics.match}, mismatch:${semantics.mismatch}, unavailable:${semantics.unavailable}`,
    `  duplicateSteps=decisions captured:${renderNumberList(audit.fidelity.decisions.duplicateCapturedStepIndices)}, replayed:${renderNumberList(audit.fidelity.decisions.duplicateReplayedStepIndices)}; semantics captured:${renderNumberList(audit.fidelity.semantics.duplicateCapturedStepIndices)}, replayed:${renderNumberList(audit.fidelity.semantics.duplicateReplayedStepIndices)}`,
    `  pressure=ambiguity:${audit.pressure.ambiguousDecisions}, recovery:${audit.pressure.ambiguousRecoveries}, lowConfidence:${audit.pressure.lowConfidenceDecisions}, abstained:${audit.pressure.abstainedDecisions}, continuity:${audit.pressure.continuityOverrides}, merged:${audit.pressure.mergedEpisodeUpdates}, visibleEnd:${audit.pressure.activeWorkLeft}`,
    `  cues=${audit.review.cues.join(", ") || "none"}`,
    `  why=${audit.review.rationale.join("; ")}`,
  ].join("\n");
}

function renderDuplicateGroups(groups: SessionReplayAuditReport["duplicateSessionIds"]): string {
  return groups
    .map((group) => `${group.key} (${group.paths.length || group.sessionIds.length})`)
    .join(", ");
}

function renderNumberList(values: readonly number[]): string {
  return values.length > 0 ? values.join(",") : "none";
}

function printHelp(): void {
  stdout.write(
    [
      "Usage: pnpm session:audit [options]",
      "",
      "Replay harvested session bundles and audit repeatability, capture fidelity, and pressure.",
      "",
      "Options:",
      "  --bundle <path>  Audit one session bundle JSON (repeatable)",
      "  --dir <path>     Audit every session bundle under a directory (repeatable)",
      "  --json           Emit JSON instead of text",
      "  --help           Show this help text",
      "",
      `Default input directory: ${DEFAULT_SESSION_BUNDLES_DIR}`,
    ].join("\n"),
  );
  stdout.write("\n");
}

function printUsageAndExit(printUsage: () => void): never {
  printUsage();
  process.exit(0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingDirectoryError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

void main();
