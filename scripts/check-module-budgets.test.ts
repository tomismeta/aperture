import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  collectCoreSemanticFiles,
  collectSemanticMatcherGovernedFiles,
  countObservationPrimitiveLines,
  countSemanticMatcherSites,
  countSemanticPhraseLiterals,
  countTaskFailureParsingLines,
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

test("module budget checker includes observation grammar in matcher governance", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-module-budgets-"));
  try {
    await writeRepoFile(
      root,
      "packages/core/src/semantic-top-level.ts",
      "export const top = true;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/task-failure-observation-grammar.ts",
      "export const grammar = true;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/task-failure-payload-observation-grammar.ts",
      "export const payloadGrammar = true;\n",
    );

    const governedFiles = (await collectSemanticMatcherGovernedFiles(root)).map((file) =>
      file.replace(`${root}/`, ""),
    );

    assert.deepEqual(governedFiles, [
      "packages/core/src/semantic-top-level.ts",
      "packages/core/src/task-failure-observation-grammar.ts",
      "packages/core/src/task-failure-payload-observation-grammar.ts",
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

test("module budget checker counts the observation primitive as one governed surface", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-module-budgets-"));
  try {
    await writeRepoFile(root, "packages/core/src/observation-semantics.ts", "type One = 1;\n");
    await writeRepoFile(
      root,
      "packages/core/src/normalized-observation.ts",
      "type One = 1;\ntype Two = 2;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/task-failure-observation-grammar.ts",
      "const one = 1;\nconst two = 2;\nconst three = 3;\nconst four = 4;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/task-failure-payload-observation-grammar.ts",
      "const one = 1;\nconst two = 2;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/task-failure-evidence-observation-grammar.ts",
      "const one = 1;\nconst two = 2;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/task-failure-observation-core.ts",
      "const one = 1;\nconst two = 2;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/task-failure-observation-normalizer.ts",
      "const one = 1;\nconst two = 2;\nconst three = 3;\n",
    );

    assert.equal(await countObservationPrimitiveLines(root), 23);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("module budget checker counts task-failure parsing as one governed surface", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-module-budgets-"));
  try {
    await writeRepoFile(
      root,
      "packages/core/src/task-failure-observation-grammar.ts",
      "const one = 1;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/task-failure-payload-observation-grammar.ts",
      "const one = 1;\nconst two = 2;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/semantic-task-failure-signals.ts",
      "const one = 1;\nconst two = 2;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/semantic-evidence.ts",
      "const one = 1;\nconst two = 2;\nconst three = 3;\n",
    );
    await writeRepoFile(root, "packages/core/src/semantic-failure-detail.ts", "const one = 1;\n");
    await writeRepoFile(
      root,
      "packages/core/src/semantic-edit-output-shapes.ts",
      "const one = 1;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/semantic-tool-use-rejection-shapes.ts",
      "const one = 1;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/semantic-task-failure-structured-output.ts",
      "const one = 1;\n",
    );

    assert.equal(await countTaskFailureParsingLines(root), 20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeRepoFile(root: string, relativePath: string, content: string): Promise<void> {
  const file = resolve(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}
