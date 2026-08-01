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
    name: "core-attention-evaluator",
    entrypoint: join(repoRoot, "examples", "core-attention-evaluator", "index.ts"),
  },
  {
    name: "core-semantic-entrypoint",
    entrypoint: join(repoRoot, "examples", "core-semantic-entrypoint", "index.ts"),
  },
  {
    name: "core-trace-entrypoint",
    entrypoint: join(repoRoot, "examples", "core-trace-entrypoint", "index.ts"),
  },
];

type CorePackageJson = {
  name: string;
  version: string;
  exports?: Record<string, unknown>;
};

function run(
  command: string,
  args: string[],
  cwd: string,
  options: { ignoreScripts?: boolean } = {},
): void {
  const ignoreScripts = options.ignoreScripts ?? true;
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_ignore_scripts: ignoreScripts ? "true" : "false",
    },
  });
}

function runExpectFailure(
  command: string,
  args: string[],
  cwd: string,
  expectedOutput: RegExp,
): void {
  try {
    execFileSync(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        npm_config_ignore_scripts: "true",
      },
      encoding: "utf8",
    });
  } catch (error) {
    const output =
      error !== null && typeof error === "object"
        ? `${"stdout" in error ? String(error.stdout ?? "") : ""}${
            "stderr" in error ? String(error.stderr ?? "") : ""
          }`
        : "";
    assert.match(output, expectedOutput);
    return;
  }

  assert.fail(`${command} ${args.join(" ")} was expected to fail`);
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
  const disallowedPrefixes = ["package/src/", "package/test/"];
  const disallowedEntries = ["package/tsconfig.json", "package/tsconfig.tsbuildinfo"];

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
  assert.equal(
    entries.includes("package/package.json"),
    true,
    "tarball should include package.json",
  );
  assert.equal(
    entries.includes("package/public-dist/index.js"),
    true,
    "tarball should include built entrypoint",
  );
  assert.equal(
    entries.includes("package/public-dist/evaluator.js"),
    true,
    "tarball should include evaluator entrypoint",
  );
  assert.equal(
    entries.includes("package/public-dist/evaluator.d.ts"),
    true,
    "tarball should include evaluator declarations",
  );
  assert.equal(
    entries.includes("package/public-dist/semantic.js"),
    true,
    "tarball should include semantic entrypoint",
  );
  assert.equal(
    entries.includes("package/public-dist/trace.js"),
    true,
    "tarball should include trace entrypoint",
  );
  assert.equal(
    entries.includes("package/public-dist/internal.js"),
    false,
    "tarball should not include internal entrypoint",
  );
  assert.equal(
    entries.includes("package/public-dist/internal.d.ts"),
    false,
    "tarball should not include internal declarations",
  );
  assert.equal(
    entries.some((entry) => entry.startsWith("package/dist/")),
    false,
    "tarball should not include internal dist output",
  );
  assert.equal(
    entries.some((entry) => entry.endsWith(".js.map")),
    false,
    "tarball should not include JavaScript source maps",
  );
  assert.equal(
    entries.some((entry) => entry.endsWith(".d.ts.map")),
    false,
    "tarball should not include declaration maps",
  );
  assert.equal(
    entries.some((entry) => entry.includes("attention-heuristics")),
    false,
    "tarball should not include stale renamed artifacts",
  );
  assert.equal(
    entries.some((entry) => entry.includes("episode-store")),
    false,
    "tarball should not include stale renamed artifacts",
  );
  assert.equal(
    entries.some((entry) => entry.includes("evaluation-engine")),
    false,
    "tarball should not include stale renamed artifacts",
  );
  assert.equal(
    entries.some((entry) => entry.includes("interaction-coordinator")),
    false,
    "tarball should not include stale renamed artifacts",
  );
  assert.equal(
    entries.some((entry) => entry.includes("interaction-signal-store")),
    false,
    "tarball should not include stale renamed artifacts",
  );
  assert.equal(
    entries.some((entry) => entry.includes("policy-gates")),
    false,
    "tarball should not include stale renamed artifacts",
  );
  assert.equal(
    entries.some((entry) => entry.includes("pressure-forecast")),
    false,
    "tarball should not include stale renamed artifacts",
  );
  assert.equal(
    entries.some((entry) => entry.includes("queue-planner")),
    false,
    "tarball should not include stale renamed artifacts",
  );
  assert.equal(
    entries.some((entry) => entry.includes("utility-score")),
    false,
    "tarball should not include stale renamed artifacts",
  );
}

async function main(): Promise<void> {
  const packageJson = JSON.parse(
    await readFile(join(coreDir, "package.json"), "utf8"),
  ) as CorePackageJson;
  assert.equal(
    Boolean(packageJson.exports && "./internal" in packageJson.exports),
    false,
    "@tomismeta/aperture-core should not publish an ./internal subpath",
  );

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
        `${JSON.stringify(
          {
            name: example.name,
            private: true,
            type: "module",
            dependencies: {
              "@tomismeta/aperture-core": `file:${tarballPath}`,
            },
            devDependencies: {
              "@types/node": "^24.1.0",
              typescript: "^5.9.2",
              tsx: "^4.20.5",
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await writeFile(
        join(exampleDir, "pnpm-workspace.yaml"),
        "packages:\n  - .\nallowBuilds:\n  esbuild: true\nautoInstallPeers: false\n",
        "utf8",
      );
      await writeFile(
        join(exampleDir, "tsconfig.json"),
        `${JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              strict: true,
              noEmit: true,
              skipLibCheck: false,
              types: ["node"],
            },
            include: ["index.ts"],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      run("pnpm", ["install", "--prefer-offline"], exampleDir, { ignoreScripts: false });
      run("pnpm", ["exec", "tsc", "--noEmit"], exampleDir);
      run("pnpm", ["exec", "tsx", "index.ts"], exampleDir);
    }

    const negativeDir = join(tempRoot, "core-internal-observation-negative");
    await mkdir(negativeDir, { recursive: true });
    await writeFile(
      join(negativeDir, "index.ts"),
      [
        'import type { NormalizedObservation as RootObservation } from "@tomismeta/aperture-core";',
        'import type { NormalizedObservation as EvaluatorObservation } from "@tomismeta/aperture-core/evaluator";',
        'import type { NormalizedObservation as SemanticObservation } from "@tomismeta/aperture-core/semantic";',
        'import type { NormalizedObservation as TraceObservation } from "@tomismeta/aperture-core/trace";',
        "void (0 as unknown as RootObservation);",
        "void (0 as unknown as EvaluatorObservation);",
        "void (0 as unknown as SemanticObservation);",
        "void (0 as unknown as TraceObservation);",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(negativeDir, "package.json"),
      `${JSON.stringify(
        {
          name: "core-internal-observation-negative",
          private: true,
          type: "module",
          dependencies: {
            "@tomismeta/aperture-core": `file:${tarballPath}`,
          },
          devDependencies: {
            "@types/node": "^24.1.0",
            typescript: "^5.9.2",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      join(negativeDir, "pnpm-workspace.yaml"),
      "packages:\n  - .\nautoInstallPeers: false\n",
      "utf8",
    );
    await writeFile(
      join(negativeDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            types: ["node"],
          },
          include: ["index.ts"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    run("pnpm", ["install", "--prefer-offline"], negativeDir, { ignoreScripts: false });
    runExpectFailure("pnpm", ["exec", "tsc", "--noEmit"], negativeDir, /NormalizedObservation/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  assert.fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
