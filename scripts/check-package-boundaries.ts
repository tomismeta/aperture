import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), "..");
const ignoredDirNames = new Set([
  ".aperture",
  ".claude",
  ".codex",
  ".git",
  "dist",
  "public-dist",
  "node_modules",
]);
const siblingPackageNames = [
  "aperture",
  "claude-code",
  "codex",
  "lab",
  "opencode",
  "pi",
  "runtime",
  "tui",
] as const;
const prohibitedWorkspacePackages = [
  "@tomismeta/aperture",
  "@aperture/claude-code",
  "@aperture/codex",
  "@aperture/lab",
  "@aperture/opencode",
  "@aperture/pi",
  "@aperture/runtime",
  "@aperture/tui",
] as const;
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
const rawJudgmentFailureEvidencePattern = /\bjudgmentInput\.failureEvidence\b/g;

export type ImportViolation = { file: string; label: string; imports: string[]; guidance: string };
export type CorpusLabelViolation = { file: string; labels: string[] };
export type JudgmentInputViolation = { file: string; matches: string[]; guidance: string };
export type BoundaryCheckResult = {
  importViolations: ImportViolation[];
  corpusLabelViolations: CorpusLabelViolation[];
  judgmentInputViolations: JudgmentInputViolation[];
};

export async function checkPackageBoundaries(root = defaultRepoRoot): Promise<BoundaryCheckResult> {
  const files = await collectSourceFiles(root);
  const importViolations: ImportViolation[] = [];
  const corpusLabelViolations: CorpusLabelViolation[] = [];
  const judgmentInputViolations: JudgmentInputViolation[] = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const importSpecifiers = collectModuleSpecifiers(content);
    if (isCoreTestSource(root, file)) {
      pushImportViolation(
        importViolations,
        file,
        "adapter implementation from core tests",
        collectSiblingImplementationImports(root, file, importSpecifiers),
        "Core tests should validate canonical SourceEvents. Adapter parity belongs in the adapter package that owns the mapper.",
      );
      pushImportViolation(
        importViolations,
        file,
        "adapter workspace package from core tests",
        collectWorkspacePackageImports(importSpecifiers),
        "Core tests should validate canonical SourceEvents. Adapter parity belongs in the adapter package that owns the mapper.",
      );
    }
    if (isProductionCoreSource(root, file)) {
      pushImportViolation(
        importViolations,
        file,
        "sibling package implementation from production core",
        collectSiblingImplementationImports(root, file, importSpecifiers),
        "Keep production core independent. Share contracts through public core exports or move integration coverage into the owning adapter package.",
      );
      pushImportViolation(
        importViolations,
        file,
        "sibling workspace package from production core",
        collectWorkspacePackageImports(importSpecifiers),
        "Keep production core independent. Share contracts through public core exports or move integration coverage into the owning adapter package.",
      );
      const rawFailureEvidenceReads = collectRawJudgmentFailureEvidenceReads(content);
      if (rawFailureEvidenceReads.length > 0) {
        judgmentInputViolations.push({
          file,
          matches: rawFailureEvidenceReads,
          guidance:
            "Judgment and policy code should consume observation. Keep raw task-failure evidence local to semantic evidence readers and the NormalizedObservation normalizer.",
        });
      }
    }
    if (shouldIgnore(file)) {
      continue;
    }

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

    if (isProductionCoreSource(root, file)) {
      const labels = collectCorpusLabels(content);
      if (labels.length > 0) {
        corpusLabelViolations.push({ file, labels });
      }
    }
  }

  return { importViolations, corpusLabelViolations, judgmentInputViolations };
}

export function renderBoundaryCheckReport(root: string, result: BoundaryCheckResult): string {
  const lines = ["Package boundary check failed.", ""];

  for (const violation of result.importViolations) {
    lines.push(`These files still reach into ${violation.label} directly:`);
    lines.push(`- ${relative(root, violation.file)}`);
    for (const importPath of violation.imports) {
      lines.push(`    ${importPath}`);
    }
    lines.push("");
    lines.push(violation.guidance);
    lines.push("");
  }

  if (result.corpusLabelViolations.length > 0) {
    lines.push("Production core contains corpus-specific labels:");
    for (const violation of result.corpusLabelViolations) {
      lines.push(`- ${relative(root, violation.file)}: ${violation.labels.join(", ")}`);
    }
    lines.push("");
    lines.push(
      "Keep dataset-specific names in Lab, tests, fixtures, or docs. Promote only generalized event-shape predicates into packages/core/src.",
    );
    lines.push("");
  }

  if (result.judgmentInputViolations.length > 0) {
    lines.push("Production core reads raw judgment failure evidence after normalization:");
    for (const violation of result.judgmentInputViolations) {
      lines.push(`- ${relative(root, violation.file)}: ${violation.matches.join(", ")}`);
    }
    lines.push("");
    lines.push(result.judgmentInputViolations[0]?.guidance ?? "");
    lines.push("");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const result = await checkPackageBoundaries(defaultRepoRoot);

  if (
    result.importViolations.length === 0 &&
    result.corpusLabelViolations.length === 0 &&
    result.judgmentInputViolations.length === 0
  ) {
    return;
  }

  process.stderr.write(`${renderBoundaryCheckReport(defaultRepoRoot, result)}\n`);
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

function isProductionCoreSource(root: string, file: string): boolean {
  return relative(root, file).startsWith("packages/core/src/");
}

function isCoreTestSource(root: string, file: string): boolean {
  return relative(root, file).startsWith("packages/core/test/");
}

function collectModuleSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  const importExportPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g;
  const callPattern = /\b(?:import|require)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

  for (const match of content.matchAll(importExportPattern)) {
    if (match[1] !== undefined) {
      specifiers.add(match[1]);
    }
  }
  for (const match of content.matchAll(callPattern)) {
    if (match[1] !== undefined) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function collectRawJudgmentFailureEvidenceReads(content: string): string[] {
  return [...content.matchAll(rawJudgmentFailureEvidencePattern)]
    .map((match) => match[0])
    .filter(Boolean);
}

function collectSiblingImplementationImports(
  root: string,
  file: string,
  specifiers: string[],
): string[] {
  const packageSrcRoots = siblingPackageNames.map((name) => resolve(root, "packages", name, "src"));
  return specifiers.filter((specifier) => {
    if (!specifier.startsWith(".")) {
      return false;
    }
    const resolvedSpecifier = resolve(dirname(file), specifier);
    return packageSrcRoots.some((packageSrcRoot) =>
      isPathWithinOrEqual(resolvedSpecifier, packageSrcRoot),
    );
  });
}

function collectWorkspacePackageImports(specifiers: string[]): string[] {
  return specifiers.filter((specifier) =>
    prohibitedWorkspacePackages.some(
      (packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`),
    ),
  );
}

function pushImportViolation(
  violations: ImportViolation[],
  file: string,
  label: string,
  imports: string[],
  guidance: string,
): void {
  if (imports.length === 0) {
    return;
  }
  violations.push({ file, label, imports, guidance });
}

function isPathWithinOrEqual(candidate: string, parent: string): boolean {
  const relativePath = relative(parent, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
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

if (process.argv[1] === scriptPath) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
