import {
  createWorkflowSummaryReport,
  loadSessionBundle,
  loadSessionBundles,
  renderWorkflowSummaryMarkdown,
} from "./index.js";
import { parseWorkflowSummaryArgs } from "./fstop-cli-args.js";
import { emitResult, writeDirectoryFile } from "./fstop-cli-shared.js";

export async function runWorkflowSummaryCli(argv: string[]): Promise<void> {
  const options = parseWorkflowSummaryArgs(argv);
  const bundles = await loadDistinctBundles(options.bundlePaths, options.bundleDirectories);
  const report = createWorkflowSummaryReport(bundles);
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

async function loadDistinctBundles(
  bundlePaths: string[],
  bundleDirectories: string[],
) {
  const directBundles = await Promise.all(bundlePaths.map((bundlePath) => loadSessionBundle(bundlePath)));
  const directoryBundles = (
    await Promise.all(bundleDirectories.map((directory) => loadSessionBundles(directory)))
  ).flat();

  const seen = new Set<string>();
  const bundles = [...directBundles, ...directoryBundles];

  return bundles.filter((bundle) => {
    const key = `${bundle.sessionId}:${bundle.exportedAt}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
