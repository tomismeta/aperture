import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  collectCoreSemanticFiles,
  countSemanticMatcherSites,
  countSemanticPhraseLiterals,
} from "./check-module-budgets.ts";

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

test("module budget checker counts semantic matcher sites", () => {
  assert.equal(
    countSemanticMatcherSites(`
      const exact = /^file has not been read yet$/i;
      const dynamic = new RegExp("failure", "i");
      if (containsAnySemanticPhrase(text, PHRASES)) return true;
      // /^commented out$/i
    `),
    3,
  );
});

test("module budget checker counts phrase-table literals", () => {
  assert.equal(
    countSemanticPhraseLiterals(`
      export const FAILURE_PHRASES = [
        "cannot continue",
        'blocked on',
        // "commented phrase"
      ] as const;
      const ORDINARY_VALUES = ["not a phrase table"] as const;
      export const SAFE_NEGATIONS = ["no action needed"] as const;
    `),
    3,
  );
});

async function writeRepoFile(root: string, relativePath: string, content: string): Promise<void> {
  const file = resolve(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}
