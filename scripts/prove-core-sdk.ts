import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

type Example = {
  name: string;
  entrypoint: string;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const coreDir = join(repoRoot, "packages", "core");
const examples: Example[] = [
  {
    name: "core-full-engine",
    entrypoint: join(repoRoot, "examples", "core-full-engine", "index.mjs"),
  },
  {
    name: "core-judgment-primitives",
    entrypoint: join(repoRoot, "examples", "core-judgment-primitives", "index.mjs"),
  },
];

type CorePackageJson = {
  name: string;
  version: string;
};

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_ignore_scripts: "true",
    },
  });
}

function tarballName(pkg: CorePackageJson): string {
  return `${pkg.name.replace(/^@/, "").replace(/\//g, "-")}-${pkg.version}.tgz`;
}

async function main(): Promise<void> {
  const packageJson = JSON.parse(
    await readFile(join(coreDir, "package.json"), "utf8"),
  ) as CorePackageJson;

  const tempRoot = await mkdtemp(join(tmpdir(), "aperture-sdk-proving-"));
  const packDir = join(tempRoot, "pack");
  await mkdir(packDir, { recursive: true });

  try {
    run("pnpm", ["--dir", coreDir, "build"], repoRoot);
    run("pnpm", ["--dir", coreDir, "pack", "--pack-destination", packDir], repoRoot);

    const tarballPath = join(packDir, tarballName(packageJson));

    for (const example of examples) {
      const exampleDir = join(tempRoot, example.name);
      await mkdir(exampleDir, { recursive: true });
      await cp(example.entrypoint, join(exampleDir, "index.mjs"));
      await writeFile(
        join(exampleDir, "package.json"),
        `${JSON.stringify({
          name: example.name,
          private: true,
          type: "module",
          dependencies: {
            "@aperture/core": `file:${tarballPath}`,
          },
        }, null, 2)}\n`,
        "utf8",
      );

      run("pnpm", ["install", "--offline"], exampleDir);
      run("node", ["index.mjs"], exampleDir);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  assert.fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
