import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { checkPackageBoundaries, renderBoundaryCheckReport } from "./check-package-boundaries.ts";

test("boundary checker rejects corpus labels in production core", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-boundaries-"));
  try {
    await writeRepoFile(
      root,
      "packages/core/src/semantic-dataclaw.ts",
      'export const dataset = "dataclaw";\n',
    );

    const result = await checkPackageBoundaries(root);

    assert.equal(result.importViolations.length, 0);
    assert.equal(result.corpusLabelViolations.length, 1);
    assert.match(
      result.corpusLabelViolations[0]?.file ?? "",
      /packages\/core\/src\/semantic-dataclaw\.ts$/,
    );
    assert.deepEqual(result.corpusLabelViolations[0]?.labels, ["DataClaw"]);

    const report = renderBoundaryCheckReport(root, result);
    assert.match(report, /Production core contains corpus-specific labels/);
    assert.match(report, /generalized event-shape predicates/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("boundary checker allows corpus labels in Lab and tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-boundaries-"));
  try {
    await writeRepoFile(
      root,
      "packages/lab/src/public-trajectories-dataclaw.ts",
      'export const dataset = "dataclaw";\n',
    );
    await writeRepoFile(
      root,
      "packages/core/test/semantic-normalization.test.ts",
      'const source = "swe-smith";\n',
    );
    await writeRepoFile(
      root,
      "packages/core/src/semantic-general-shape.ts",
      'export const shape = "source evidence truncated";\n',
    );

    const result = await checkPackageBoundaries(root);

    assert.deepEqual(result.importViolations, []);
    assert.deepEqual(result.corpusLabelViolations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeRepoFile(root: string, relativePath: string, content: string): Promise<void> {
  const file = resolve(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}
