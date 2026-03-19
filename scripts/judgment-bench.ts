import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runJudgmentBench } from "@aperture/lab";

const RESULTS_DIR = path.resolve(process.cwd(), "packages/lab/results");

async function main(): Promise<void> {
  const result = await runJudgmentBench();

  await mkdir(RESULTS_DIR, { recursive: true });

  const timestamp = result.generatedAt.replaceAll(":", "-");
  const outputPath = path.join(RESULTS_DIR, `judgmentbench-${timestamp}.json`);
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  process.stdout.write(
    [
      `JudgmentBench scenarios: ${result.summary.totalScenarios}`,
      `activated: ${result.summary.totalActivated}`,
      `queued: ${result.summary.totalQueued}`,
      `ambient: ${result.summary.totalAmbient}`,
      `results: ${outputPath}`,
    ].join("\n") + "\n",
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
