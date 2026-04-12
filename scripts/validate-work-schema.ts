import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateWorkEventBatchShape, validateWorkEventShape } from "@aperture/runtime/internal";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = resolve(repoRoot, "schemas/examples/work-event");

function main(): void {
  const filenames = readdirSync(examplesDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort();

  if (filenames.length === 0) {
    throw new Error("No canonical work-event examples were found to validate.");
  }

  const examples = filenames.map((filename) => {
    const path = resolve(examplesDir, filename);
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const errors = validateWorkEventShape(value);
    if (errors.length > 0) {
      throw new Error(
        [`Canonical work-event example failed schema validation: ${filename}`, ...errors].join(
          "\n",
        ),
      );
    }
    return value;
  });

  const batchErrors = validateWorkEventBatchShape(examples);
  if (batchErrors.length > 0) {
    throw new Error(
      ["Canonical work-event batch failed schema validation.", ...batchErrors].join("\n"),
    );
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
