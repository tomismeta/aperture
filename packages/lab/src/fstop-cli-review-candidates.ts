import path from "node:path";

import {
  createSemanticReviewCandidateReportFromPaths,
  defaultSemanticReviewCandidateReportPath,
  renderSemanticReviewCandidateMarkdown,
  writeSemanticReviewCandidateMarkdown,
  writeSemanticReviewCandidateReport,
} from "./index.js";
import { parseReviewCandidateArgs } from "./fstop-cli-args.js";
import { emitResult } from "./fstop-cli-shared.js";

export async function runReviewCandidatesCli(argv: string[]): Promise<void> {
  const options = parseReviewCandidateArgs(argv);
  const report = await createSemanticReviewCandidateReportFromPaths({
    manifestPaths: options.manifestPaths,
    bundlePaths: options.bundlePaths,
    bundleDirectories: options.bundleDirectories,
    maxCandidatesPerKind: options.maxCandidatesPerKind,
    maxCandidatesPerSessionPerKind: options.maxCandidatesPerSessionPerKind,
  });
  const outputPath = options.outputPath ?? defaultSemanticReviewCandidateReportPath(report);
  const markdownPath =
    options.markdownOutputPath ?? defaultSemanticReviewCandidateMarkdownPath(outputPath);
  if (path.resolve(outputPath) === path.resolve(markdownPath)) {
    throw new Error("review-candidates JSON and Markdown outputs must be different paths.");
  }

  await writeSemanticReviewCandidateReport(outputPath, report);
  await writeSemanticReviewCandidateMarkdown(markdownPath, report);

  emitResult(
    options.json,
    {
      status: "ok" as const,
      outputPath,
      markdownPath,
      generatedAt: report.generatedAt,
      selection: report.selection,
      input: report.input,
      summary: report.summary,
    },
    [
      renderSemanticReviewCandidateMarkdown(report),
      `JSON: ${outputPath}`,
      `Markdown: ${markdownPath}`,
    ],
  );
}

function defaultSemanticReviewCandidateMarkdownPath(outputPath: string): string {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name || "semantic-review-candidates"}.md`);
}
