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
    entrypoint: join(repoRoot, "examples", "core-full-engine", "index.ts"),
  },
  {
    name: "core-semantic-entrypoint",
    entrypoint: join(repoRoot, "examples", "core-semantic-entrypoint", "index.ts"),
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

function listTarballEntries(tarballPath: string): string[] {
  return execFileSync("tar", ["-tzf", tarballPath], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function assertTarballShape(entries: string[]): void {
  const disallowedPrefixes = [
    "package/src/",
    "package/test/",
  ];
  const disallowedEntries = [
    "package/tsconfig.json",
    "package/tsconfig.tsbuildinfo",
  ];

  for (const prefix of disallowedPrefixes) {
    assert.equal(
      entries.some((entry) => entry.startsWith(prefix)),
      false,
      `tarball should not include ${prefix}`,
    );
  }

  for (const entry of disallowedEntries) {
    assert.equal(entries.includes(entry), false, `tarball should not include ${entry}`);
  }

  assert.equal(entries.includes("package/README.md"), true, "tarball should include README.md");
  assert.equal(entries.includes("package/LICENSE"), true, "tarball should include LICENSE");
  assert.equal(entries.includes("package/package.json"), true, "tarball should include package.json");
  assert.equal(entries.includes("package/dist/index.js"), true, "tarball should include built entrypoint");
  assert.equal(entries.some((entry) => entry.endsWith(".js.map")), false, "tarball should not include JavaScript source maps");
  assert.equal(entries.some((entry) => entry.endsWith(".d.ts.map")), false, "tarball should not include declaration maps");
  assert.equal(entries.some((entry) => entry.includes("attention-heuristics")), false, "tarball should not include stale renamed artifacts");
  assert.equal(entries.some((entry) => entry.includes("episode-store")), false, "tarball should not include stale renamed artifacts");
  assert.equal(entries.some((entry) => entry.includes("evaluation-engine")), false, "tarball should not include stale renamed artifacts");
  assert.equal(entries.some((entry) => entry.includes("interaction-coordinator")), false, "tarball should not include stale renamed artifacts");
  assert.equal(entries.some((entry) => entry.includes("interaction-signal-store")), false, "tarball should not include stale renamed artifacts");
  assert.equal(entries.some((entry) => entry.includes("policy-gates")), false, "tarball should not include stale renamed artifacts");
  assert.equal(entries.some((entry) => entry.includes("pressure-forecast")), false, "tarball should not include stale renamed artifacts");
  assert.equal(entries.some((entry) => entry.includes("queue-planner")), false, "tarball should not include stale renamed artifacts");
  assert.equal(entries.some((entry) => entry.includes("utility-score")), false, "tarball should not include stale renamed artifacts");
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
    assertTarballShape(listTarballEntries(tarballPath));

    for (const example of examples) {
      const exampleDir = join(tempRoot, example.name);
      await mkdir(exampleDir, { recursive: true });
      await cp(example.entrypoint, join(exampleDir, "index.ts"));
      await writeFile(
        join(exampleDir, "package.json"),
        `${JSON.stringify({
          name: example.name,
          private: true,
          type: "module",
          dependencies: {
            "@tomismeta/aperture-core": `file:${tarballPath}`,
          },
          devDependencies: {
            tsx: "^4.20.5",
          },
        }, null, 2)}\n`,
        "utf8",
      );

      run("pnpm", ["install", "--offline"], exampleDir);
      run("pnpm", ["exec", "tsx", "index.ts"], exampleDir);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  assert.fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
