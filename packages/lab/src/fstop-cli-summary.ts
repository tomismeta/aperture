import {
  createWorkflowSummaryReportFromSessions,
  renderWorkflowSummaryMarkdown,
  summarizeWorkflowSession,
} from "./index.js";
import { parseWorkflowSummaryArgs } from "./fstop-cli-args.js";
import { emitResult, writeDirectoryFile } from "./fstop-cli-shared.js";
import {
  findSessionBundleFiles,
  loadSessionBundle,
  loadSessionBundleIfValid,
} from "./session-bundle.js";

export async function runWorkflowSummaryCli(argv: string[]): Promise<void> {
  const options = parseWorkflowSummaryArgs(argv);
  const report = createWorkflowSummaryReportFromSessions(
    await loadDistinctBundleSummaries(options.bundlePaths, options.bundleDirectories),
  );
  const markdown = renderWorkflowSummaryMarkdown(report);

  if (options.outputPath) {
    await writeDirectoryFile(options.outputPath, `${markdown}\n`);
  }

  if (!options.json && !options.outputPath) {
    process.stdout.write(`${markdown}\n`);
    return;
  }

  emitResult(
    options.json,
    {
      status: "ok" as const,
      ...(options.outputPath ? { outputPath: options.outputPath } : {}),
      report,
    },
    [
      `Workflow summary covers ${report.summary.sessionCount} session(s).`,
      ...(options.outputPath ? [`Summary: ${options.outputPath}`] : []),
      `Events: ${report.summary.eventCount}`,
      `Approvals: ${report.summary.requestKinds.approval}`,
      `Models: ${report.summary.workflow?.models.join(", ") || "(none)"}`,
    ],
  );
}

async function loadDistinctBundleSummaries(bundlePaths: string[], bundleDirectories: string[]) {
  const seen = new Set<string>();
  const summaries: ReturnType<typeof summarizeWorkflowSession>[] = [];

  for (const bundlePath of bundlePaths) {
    const bundle = await loadSessionBundle(bundlePath);
    const key = `${bundle.sessionId}:${bundle.exportedAt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    summaries.push(summarizeWorkflowSession(bundle));
  }

  for (const directory of bundleDirectories) {
    const bundleFiles = await findSessionBundleFiles(directory);
    for (const bundlePath of bundleFiles) {
      const bundle = await loadSessionBundleIfValid(bundlePath);
      if (!bundle) {
        continue;
      }
      const key = `${bundle.sessionId}:${bundle.exportedAt}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      summaries.push(summarizeWorkflowSession(bundle));
    }
  }

  return summaries;
}
