import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = resolve(repoRoot, "packages");
const ignoredDirNames = new Set(["dist", "public-dist", "node_modules"]);
const boundaryRules = [
  {
    label: "packages/core/src",
    importPattern: /["']((?:\.\.\/)+core\/src\/[^"']+)["']/g,
    allowedSuffix: "/core/src/internal-contract.js",
    guidance: "Promote real contracts to @tomismeta/aperture-core or route workspace-private needs through packages/core/src/internal-contract.ts.",
  },
  {
    label: "packages/runtime/src",
    importPattern: /["']((?:\.\.\/)+runtime\/src\/[^"']+)["']/g,
    allowedSuffix: "/runtime/src/internal-contract.js",
    guidance: "Route workspace-private runtime dependencies through packages/runtime/src/internal-contract.ts instead of reaching into runtime internals directly.",
  },
] as const;

async function main(): Promise<void> {
  const files = await collectSourceFiles(packagesRoot);
  const violations: Array<{ file: string; label: string; imports: string[]; guidance: string }> = [];

  for (const file of files) {
    if (shouldIgnore(file)) {
      continue;
    }

    const content = await readFile(file, "utf8");
    for (const rule of boundaryRules) {
      const imports = [...content.matchAll(rule.importPattern)].map((match) => match[1] ?? "").filter(Boolean);
      if (imports.length === 0) {
        continue;
      }
      if (imports.every((importPath) => importPath.endsWith(rule.allowedSuffix))) {
        continue;
      }
      violations.push({
        file,
        label: rule.label,
        imports,
        guidance: rule.guidance,
      });
    }
  }

  if (violations.length === 0) {
    return;
  }

  const lines = [
    "Package boundary check failed.",
    "",
  ];

  for (const violation of violations) {
    lines.push(`These non-test files still reach into ${violation.label} directly:`);
    lines.push(`- ${relative(repoRoot, violation.file)}`);
    for (const importPath of violation.imports) {
      lines.push(`    ${importPath}`);
    }
    lines.push("");
    lines.push(violation.guidance);
    lines.push("");
  }

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
