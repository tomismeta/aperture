import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderJudgmentBenchMarkdown, runPerturbedJudgmentBench } from "@aperture/lab";

const RESULTS_DIR = path.resolve(process.cwd(), "packages/lab/results");

async function main(): Promise<void> {
  const result = await runPerturbedJudgmentBench();
  const markdown = renderJudgmentBenchMarkdown(result);

  await mkdir(RESULTS_DIR, { recursive: true });

  const timestamp = result.generatedAt.replaceAll(":", "-");
  const jsonPath = path.join(RESULTS_DIR, `judgmentfuzz-${timestamp}.json`);
  const markdownPath = path.join(RESULTS_DIR, `judgmentfuzz-${timestamp}.md`);
  const latestJsonPath = path.join(RESULTS_DIR, "latest-fuzz.json");
  const latestMarkdownPath = path.join(RESULTS_DIR, "latest-fuzz.md");

  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(latestJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(latestMarkdownPath, markdown, "utf8");

  process.stdout.write(
    [
      `JudgmentFuzz scenarios: ${result.summary.totalScenarios}`,
      `score: ${(result.summary.benchmarkScore * 100).toFixed(1)}%`,
      `assertions: ${result.summary.passedAssertions}/${result.summary.totalAssertions}`,
      `semantic readings: ${result.summary.totalSemanticReadings}`,
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
