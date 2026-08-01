import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { collectCoreSemanticFiles } from "./check-module-budgets.ts";

test("module budget checker discovers top-level and nested semantic core modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-module-budgets-"));
  try {
    await writeRepoFile(
      root,
      "packages/core/src/semantic-top-level.ts",
      "export const top = true;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/semantic/window-limit.ts",
      "export const nested = true;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-planner.ts",
      "export const other = true;\n",
    );

    const semanticFiles = (await collectCoreSemanticFiles(root)).map((file) =>
      file.replace(`${root}/`, ""),
    );

    assert.deepEqual(semanticFiles, [
      "packages/core/src/semantic-top-level.ts",
      "packages/core/src/semantic/window-limit.ts",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeRepoFile(root: string, relativePath: string, content: string): Promise<void> {
  const file = resolve(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}
