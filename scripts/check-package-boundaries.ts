import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = resolve(repoRoot, "packages");
const allowedCoreSourceImports = new Set([
  resolve(repoRoot, "packages/runtime/src/learning-persistence.ts"),
  resolve(repoRoot, "packages/tui/src/posture.ts"),
  resolve(repoRoot, "packages/tui/src/render.ts"),
]);
const ignoredDirNames = new Set(["dist", "public-dist", "node_modules"]);
const coreSourceImportPattern = /["']((?:\.\.\/)+core\/src\/[^"']+)["']/g;

async function main(): Promise<void> {
  const files = await collectSourceFiles(packagesRoot);
  const violations: Array<{ file: string; imports: string[] }> = [];

  for (const file of files) {
    if (shouldIgnore(file)) {
      continue;
    }

    const content = await readFile(file, "utf8");
    const imports = [...content.matchAll(coreSourceImportPattern)].map((match) => match[1] ?? "").filter(Boolean);
    if (imports.length === 0) {
      continue;
    }
    if (allowedCoreSourceImports.has(file)) {
      continue;
    }

    violations.push({ file, imports });
  }

  if (violations.length === 0) {
    return;
  }

  const lines = [
    "Package boundary check failed.",
    "These non-test files still reach into packages/core/src directly:",
    "",
  ];

  for (const violation of violations) {
    lines.push(`- ${relative(repoRoot, violation.file)}`);
    for (const importPath of violation.imports) {
      lines.push(`    ${importPath}`);
    }
  }

  lines.push("");
  lines.push("Promote real contracts to @tomismeta/aperture-core or keep the import in the explicit allowlist.");

  process.stderr.write(`${lines.join("\n")}\n`);
  process.exitCode = 1;
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirNames.has(entry.name)) {
        continue;
      }
      files.push(...await collectSourceFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function shouldIgnore(file: string): boolean {
  if (file.includes("/packages/lab/")) {
    return true;
  }
  if (file.includes("/test/")) {
    return true;
  }
  if (file.includes("/fixtures/")) {
    return true;
  }
  return false;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
