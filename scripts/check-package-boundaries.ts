import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirNames = new Set([".git", "dist", "public-dist", "node_modules"]);
const boundaryRules = [
  {
    label: "packages/core/src",
    importPattern: /["']((?:\.\.\/)+core\/src\/[^"']+)["']/g,
    guidance:
      "Promote public contracts to @tomismeta/aperture-core and route workspace-private needs through @tomismeta/aperture-core/internal.",
  },
  {
    label: "packages/runtime/src",
    importPattern: /["']((?:\.\.\/)+runtime\/src\/[^"']+)["']/g,
    guidance:
      "Promote public contracts to @aperture/runtime and route workspace-private needs through @aperture/runtime/internal.",
  },
  {
    label: "@tomismeta/aperture-core/internal from TUI",
    importPattern: /["']@tomismeta\/aperture-core\/internal["']/g,
    filePattern: /packages\/tui\/src\//,
    guidance:
      "Keep TUI surfaces on stable frame metadata instead of recomputing or reaching into core internals.",
  },
] as const;

const coreCorpusLabelRules = [
  { label: "DataClaw", pattern: /\b(?:DataClaw|dataclaw)\b/g },
  { label: "Trace Commons", pattern: /\b(?:TraceCommons|Trace Commons|trace-commons)\b/g },
  { label: "SWE-smith", pattern: /\b(?:SWE-smith|swe-smith|swe_smith)\b/g },
  {
    label: "Open Agent Sessions",
    pattern: /\b(?:Open Agent Sessions|open-agent-sessions|open_agent_sessions)\b/g,
  },
  {
    label: "public trajectory",
    pattern: /\b(?:public trajectory|public trajectories|public-trajectory)\b/g,
  },
] as const;

type ImportViolation = { file: string; label: string; imports: string[]; guidance: string };
type CorpusLabelViolation = { file: string; labels: string[] };

async function main(): Promise<void> {
  const files = await collectSourceFiles(repoRoot);
  const importViolations: ImportViolation[] = [];
  const corpusLabelViolations: CorpusLabelViolation[] = [];

  for (const file of files) {
    if (shouldIgnore(file)) {
      continue;
    }

    const content = await readFile(file, "utf8");
    for (const rule of boundaryRules) {
      if (rule.filePattern && !rule.filePattern.test(file)) {
        continue;
      }
      const imports = [...content.matchAll(rule.importPattern)]
        .map((match) => match[1] ?? "")
        .filter(Boolean);
      if (imports.length === 0) {
        continue;
      }
      importViolations.push({
        file,
        label: rule.label,
        imports,
        guidance: rule.guidance,
      });
    }

    if (isProductionCoreSource(file)) {
      const labels = collectCorpusLabels(content);
      if (labels.length > 0) {
        corpusLabelViolations.push({ file, labels });
      }
    }
  }

  if (importViolations.length === 0 && corpusLabelViolations.length === 0) {
    return;
  }

  const lines = ["Package boundary check failed.", ""];

  for (const violation of importViolations) {
    lines.push(`These non-test files still reach into ${violation.label} directly:`);
    lines.push(`- ${relative(repoRoot, violation.file)}`);
    for (const importPath of violation.imports) {
      lines.push(`    ${importPath}`);
    }
    lines.push("");
    lines.push(violation.guidance);
    lines.push("");
  }

  if (corpusLabelViolations.length > 0) {
    lines.push("Production core contains corpus-specific labels:");
    for (const violation of corpusLabelViolations) {
      lines.push(`- ${relative(repoRoot, violation.file)}: ${violation.labels.join(", ")}`);
    }
    lines.push("");
    lines.push(
      "Keep dataset-specific names in Lab, tests, fixtures, or docs. Promote only generalized event-shape predicates into packages/core/src.",
    );
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
      files.push(...(await collectSourceFiles(fullPath)));
      continue;
    }

    if (
      entry.isFile() &&
      [".ts", ".tsx", ".mts", ".cts"].some((extension) => fullPath.endsWith(extension))
    ) {
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
  if (file.endsWith("/scripts/check-package-boundaries.ts")) {
    return true;
  }
  return false;
}

function isProductionCoreSource(file: string): boolean {
  return relative(repoRoot, file).startsWith("packages/core/src/");
}

function collectCorpusLabels(content: string): string[] {
  const labels = new Set<string>();
  for (const rule of coreCorpusLabelRules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(content)) {
      labels.add(rule.label);
      rule.pattern.lastIndex = 0;
    }
  }
  return [...labels];
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
