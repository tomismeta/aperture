import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, cp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const targetDir = join(process.cwd(), "packages/codex/src/generated/app-server");

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "aperture-codex-protocol-"));
  const generatedDir = join(tempRoot, "app-server");

  try {
    execFileSync("codex", ["app-server", "generate-ts", "--out", generatedDir], {
      stdio: "inherit",
    });

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(dirname(targetDir), { recursive: true });
    await cp(generatedDir, targetDir, { recursive: true });
    await rewriteGeneratedImports(targetDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function rewriteGeneratedImports(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      await rewriteGeneratedImports(entryPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) {
      continue;
    }

    const original = await readFile(entryPath, "utf8");
    const rewritten = original
      .replace(
        /from "(\.{1,2}\/[^"\n]+)";/g,
        (_match, specifier: string) => `from "${specifier}.js";`,
      )
      .replace('from "./v2.js";', 'from "./v2/index.js";');

    if (rewritten !== original) {
      await writeFile(entryPath, rewritten, "utf8");
    }
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
