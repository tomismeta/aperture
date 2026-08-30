import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalSurfaceFixtures } from "../test/support/surface-fixtures.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = path.join(packageRoot, "test", "fixtures", "surface-protocol");
const write = process.argv.includes("--write");
const fixtures = canonicalSurfaceFixtures();
const expectedNames = Object.keys(fixtures).sort();

await mkdir(fixtureDirectory, { recursive: true });

for (const name of expectedNames) {
  const message = fixtures[name];
  assert.ok(message);
  const content = `${JSON.stringify(message, null, 2)}\n`;
  const destination = path.join(fixtureDirectory, name);
  if (write) {
    await writeFile(destination, content, "utf8");
    continue;
  }
  assert.equal(
    await readFile(destination, "utf8"),
    content,
    `${name} differs from the canonical surface fixture generator`,
  );
}

if (!write) {
  const actualNames = (await readdir(fixtureDirectory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  assert.deepEqual(actualNames, expectedNames, "surface fixture set differs from the generator");
}
