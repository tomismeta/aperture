import path from "node:path";

import { runPublicCorpusImport, type PublicCorpusRunDependencies } from "./public-corpus-runner.js";
import { parseCorpusRunArgs } from "./fstop-cli-args.js";
import type { CorpusRunCliOptions } from "./fstop-cli-args-corpus.js";

export async function runCorpusRunCli(
  argv: string[],
  dependencies: PublicCorpusRunDependencies = {},
): Promise<void> {
  const options = parseCorpusRunArgs(argv);
  const result = await runPublicCorpusImport(toRunnerOptions(options), dependencies);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const mode = options.plan ? "Planned" : options.dryRun ? "Prepared" : "Imported";
  const manifest = result.manifest;
  process.stdout.write(
    `${mode} ${manifest.progress.rowsImported} public corpus record${manifest.progress.rowsImported === 1 ? "" : "s"} from ${manifest.plan.dataset} (${manifest.plan.split}).\n`,
  );

  if (result.manifestPath) {
    process.stdout.write(`Manifest: ${path.relative(process.cwd(), result.manifestPath)}\n`);
  }
  if (result.markdownPath) {
    process.stdout.write(`Report: ${path.relative(process.cwd(), result.markdownPath)}\n`);
  }
  if (result.bundlePaths.length > 0) {
    process.stdout.write("Bundles:\n");
    for (const bundlePath of result.bundlePaths) {
      process.stdout.write(`- ${path.relative(process.cwd(), bundlePath)}\n`);
    }
  }
}

function toRunnerOptions(
  options: CorpusRunCliOptions,
): Parameters<typeof runPublicCorpusImport>[0] {
  const { json: _json, ...runnerOptions } = options;
  return runnerOptions;
}
