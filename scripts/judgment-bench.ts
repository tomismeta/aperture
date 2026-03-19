import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderJudgmentBenchMarkdown, runJudgmentBench } from "@aperture/lab";

const RESULTS_DIR = path.resolve(process.cwd(), "packages/lab/results");

async function main(): Promise<void> {
  const result = await runJudgmentBench();
  const markdown = renderJudgmentBenchMarkdown(result);

  await mkdir(RESULTS_DIR, { recursive: true });

  const timestamp = result.generatedAt.replaceAll(":", "-");
  const jsonPath = path.join(RESULTS_DIR, `judgmentbench-${timestamp}.json`);
  const markdownPath = path.join(RESULTS_DIR, `judgmentbench-${timestamp}.md`);
  const latestJsonPath = path.join(RESULTS_DIR, "latest.json");
  const latestMarkdownPath = path.join(RESULTS_DIR, "latest.md");

  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(latestJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(latestMarkdownPath, markdown, "utf8");

  process.stdout.write(
    [
      `JudgmentBench scenarios: ${result.summary.totalScenarios}`,
      `score: ${(result.summary.benchmarkScore * 100).toFixed(1)}%`,
      `assertions: ${result.summary.passedAssertions}/${result.summary.totalAssertions}`,
      `active buckets: ${result.summary.totalActiveBuckets}`,
      `queued buckets: ${result.summary.totalQueuedBuckets}`,
      `ambient buckets: ${result.summary.totalAmbientBuckets}`,
      `results: ${jsonPath}`,
      `summary: ${markdownPath}`,
    ].join("\n") + "\n",
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
