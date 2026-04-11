import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { workEventBatchSchemaDocument, workEventSchemaDocument } from "@aperture/runtime/internal";
import { format } from "prettier";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = resolve(repoRoot, "schemas");

const targets = [
  {
    path: resolve(schemaDir, "work-event.schema.json"),
    document: workEventSchemaDocument(),
  },
  {
    path: resolve(schemaDir, "work-event-batch.schema.json"),
    document: workEventBatchSchemaDocument(),
  },
] as const;

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  await mkdir(schemaDir, { recursive: true });

  const mismatches: string[] = [];

  for (const target of targets) {
    const expected = await formatJson(target.document);
    const current = await readCurrentFile(target.path);

    if (checkOnly) {
      if (current !== expected) {
        mismatches.push(target.path);
      }
      continue;
    }

    if (current !== expected) {
      await writeFile(target.path, expected, "utf8");
    }
  }

  if (mismatches.length > 0) {
    const message = [
      "Generated work contract artifacts are out of date.",
      "Run `pnpm contract:generate` and commit the updated schema files:",
      ...mismatches.map((path) => `- ${path}`),
    ].join("\n");
    throw new Error(message);
  }
}

async function formatJson(document: unknown): Promise<string> {
  return format(JSON.stringify(document), { parser: "json" });
}

async function readCurrentFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
