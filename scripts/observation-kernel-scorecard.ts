import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertObservationKernelScorecardPassed,
  buildObservationKernelScorecard,
  parseObservationKernelScorecard,
  serializeKernelCanonicalJson,
} from "../packages/lab/src/index.js";

const DEFAULT_SCORECARD_PATH = "packages/lab/conformance/observation-kernel-scorecard-v1.json";
const scriptPath = fileURLToPath(import.meta.url);

export type ObservationKernelScorecardCommandOptions = {
  args?: readonly string[];
  scorecardPath?: string;
};

export async function runObservationKernelScorecardCommand(
  options: ObservationKernelScorecardCommandOptions = {},
): Promise<void> {
  const args = options.args ?? process.argv.slice(2);
  const scorecardPath = path.resolve(options.scorecardPath ?? DEFAULT_SCORECARD_PATH);
  const scorecard = buildObservationKernelScorecard();
  assertObservationKernelScorecardPassed(scorecard);
  const expected = `${serializeKernelCanonicalJson(scorecard)}\n`;

  if (args.includes("--write")) {
    await mkdir(path.dirname(scorecardPath), { recursive: true });
    await writeFile(scorecardPath, expected, "utf8");
    return;
  }

  const actual = await readFile(scorecardPath, "utf8");
  parseObservationKernelScorecard(actual);
  if (actual !== expected) {
    process.stderr.write(
      `Observation kernel scorecard is stale. Run: pnpm kernel:observation:write\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === scriptPath) {
  void runObservationKernelScorecardCommand().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
