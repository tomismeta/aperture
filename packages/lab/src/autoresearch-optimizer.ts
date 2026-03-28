import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AutoresearchOptimizationBrief } from "./autoresearch-calibration.js";

export const AUTORESEARCH_OPTIMIZER_RUN_SCHEMA_VERSION = 1 as const;

const LAB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_AUTORESEARCH_OPTIMIZER_RESULTS_DIR = path.join(
  LAB_DIR,
  "results",
  "autoresearch",
  "optimizer",
);
export const DEFAULT_AUTORESEARCH_OPTIMIZER_PROMPTS_DIR = path.join(
  DEFAULT_AUTORESEARCH_OPTIMIZER_RESULTS_DIR,
  "prompts",
);
export const DEFAULT_AUTORESEARCH_OPTIMIZER_RAW_DIR = path.join(
  DEFAULT_AUTORESEARCH_OPTIMIZER_RESULTS_DIR,
  "raw",
);
export const DEFAULT_AUTORESEARCH_OPTIMIZER_PATCHES_DIR = path.join(
  DEFAULT_AUTORESEARCH_OPTIMIZER_RESULTS_DIR,
  "patches",
);
export const DEFAULT_AUTORESEARCH_OPTIMIZER_RUNS_DIR = path.join(
  DEFAULT_AUTORESEARCH_OPTIMIZER_RESULTS_DIR,
  "runs",
);
export const DEFAULT_AUTORESEARCH_OPTIMIZER_RESULTS_LOG_PATH = path.join(
  DEFAULT_AUTORESEARCH_OPTIMIZER_RESULTS_DIR,
  "results.tsv",
);

export type AutoresearchOptimizerRunStatus =
  | "clean"
  | "improved"
  | "no_change"
  | "regressed"
  | "invalid";

export type AutoresearchOptimizerRun = {
  schemaVersion: typeof AUTORESEARCH_OPTIMIZER_RUN_SCHEMA_VERSION;
  generatedAt: string;
  provider: string;
  optimizerCommand: string;
  summary: {
    beforeMismatchCount: number;
    afterMismatchCount: number;
    beforeInvariantMismatchCount: number;
    afterInvariantMismatchCount: number;
    improved: boolean;
  };
  artifacts: {
    briefPath: string;
    beforeReportPath: string;
    afterReportPath: string;
    briefMarkdownPath?: string;
    promptPath?: string;
    rawOutputPath?: string;
    patchPath?: string;
    beforeMarkdownPath?: string;
    afterMarkdownPath?: string;
  };
  changes: {
    changedFiles: string[];
    disallowedFiles: string[];
  };
  gates: {
    autoresearchEvaluate: boolean;
    judgmentBattle?: boolean;
    releaseCheck?: boolean;
  };
  status: AutoresearchOptimizerRunStatus;
  notes: string[];
};

export function renderAutoresearchOptimizationPrompt(
  brief: AutoresearchOptimizationBrief,
  options: {
    programPath?: string;
    configPath?: string;
    skillPath?: string;
  } = {},
): string {
  const programPath = options.programPath ?? "packages/lab/research/autoresearch-program.md";
  const configPath = options.configPath ?? "packages/lab/research/autoresearch-config.json";
  const skillPath = options.skillPath ?? "skills/aperture-lab-optimizer/SKILL.md";

  const lines: string[] = [
    "# Aperture Autoresearch Optimization Task",
    "",
    "You are the optimizer for Aperture's offline semantic calibration loop.",
    "",
    "Read these first:",
    `- ${programPath}`,
    `- ${configPath}`,
    `- ${skillPath}`,
    "",
    "Goal:",
    "- reduce corrected mismatches on the frozen calibration corpus",
    "- keep invariant mismatches at zero",
    "- edit only the allowed semantic/importer files",
    "",
    "Current summary:",
    `- mismatches: ${brief.summary.mismatchCount}`,
    `- corrected mismatches: ${brief.summary.correctedMismatchCount}`,
    `- invariant mismatches: ${brief.summary.invariantMismatchCount}`,
    "",
    "Allowed edit paths:",
    ...brief.allowedEditPaths.map((line) => `- ${line}`),
    "",
    "Priority areas:",
  ];

  for (const priority of brief.priorities.slice(0, 5)) {
    lines.push(`- ${priority.focusArea}: ${priority.correctedMismatchCount} corrected mismatches`);
    lines.push(`  targets: ${priority.targets.join(", ") || "(none)"}`);
    for (const example of priority.examples.slice(0, 3)) {
      lines.push(
        `  example step ${example.stepIndex}${example.stepLabel ? ` (${example.stepLabel})` : ""}: ${renderValue(example.currentValue)} -> ${renderValue(example.expectedValue)} (${example.confidence})`,
      );
    }
  }

  lines.push(
    "",
    "Instructions:",
    "1. Make the smallest changes needed on the allowed edit surface.",
    "2. After editing, run these commands yourself:",
    ...brief.evaluationCommands.map((command) => `   - ${command}`),
    "3. If the frozen calibration mismatch count does not improve, stop and explain why.",
    "4. If invariant mismatches appear, treat that as a regression and do not widen the patch.",
    "",
    "Final response:",
    "- summarize changed files",
    "- summarize before/after mismatch counts",
    "- mention whether judgment/release gates passed",
  );

  return `${lines.join("\n")}\n`;
}

export function defaultAutoresearchOptimizerPromptPath(
  generatedAt: string,
  directory = DEFAULT_AUTORESEARCH_OPTIMIZER_PROMPTS_DIR,
): string {
  return path.join(directory, `autoresearch-optimizer-prompt-${safeTimestamp(generatedAt)}.md`);
}

export function defaultAutoresearchOptimizerRawOutputPath(
  generatedAt: string,
  directory = DEFAULT_AUTORESEARCH_OPTIMIZER_RAW_DIR,
): string {
  return path.join(directory, `autoresearch-optimizer-raw-${safeTimestamp(generatedAt)}.txt`);
}

export function defaultAutoresearchOptimizerPatchPath(
  generatedAt: string,
  directory = DEFAULT_AUTORESEARCH_OPTIMIZER_PATCHES_DIR,
): string {
  return path.join(directory, `autoresearch-optimizer-patch-${safeTimestamp(generatedAt)}.diff`);
}

export function defaultAutoresearchOptimizerRunPath(
  generatedAt: string,
  directory = DEFAULT_AUTORESEARCH_OPTIMIZER_RUNS_DIR,
): string {
  return path.join(directory, `autoresearch-optimizer-run-${safeTimestamp(generatedAt)}.json`);
}

export async function writeAutoresearchOptimizerRun(
  filePath: string,
  run: AutoresearchOptimizerRun,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export async function writeAutoresearchOptimizerPrompt(
  filePath: string,
  prompt: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, prompt, "utf8");
}

export async function writeAutoresearchOptimizerRawOutput(
  filePath: string,
  output: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, output, "utf8");
}

export async function writeAutoresearchOptimizerPatch(
  filePath: string,
  patch: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, patch, "utf8");
}

export async function appendAutoresearchOptimizerResultsLog(
  filePath: string,
  run: AutoresearchOptimizerRun,
  options: {
    runPath?: string;
  } = {},
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const header = [
    "generated_at",
    "provider",
    "status",
    "before_mismatch_count",
    "after_mismatch_count",
    "before_invariant_mismatch_count",
    "after_invariant_mismatch_count",
    "changed_file_count",
    "disallowed_file_count",
    "autoresearch_evaluate",
    "judgment_battle",
    "release_check",
    "run_path",
  ].join("\t");
  const row = [
    run.generatedAt,
    run.provider,
    run.status,
    String(run.summary.beforeMismatchCount),
    String(run.summary.afterMismatchCount),
    String(run.summary.beforeInvariantMismatchCount),
    String(run.summary.afterInvariantMismatchCount),
    String(run.changes.changedFiles.length),
    String(run.changes.disallowedFiles.length),
    formatOptionalBoolean(run.gates.autoresearchEvaluate),
    formatOptionalBoolean(run.gates.judgmentBattle),
    formatOptionalBoolean(run.gates.releaseCheck),
    options.runPath ?? run.artifacts.rawOutputPath ?? run.artifacts.briefPath,
  ].join("\t");

  const exists = await fileExists(filePath);
  await appendFile(filePath, `${exists ? "" : `${header}\n`}${row}\n`, "utf8");
}

export function renderAutoresearchOptimizerRunMarkdown(
  run: AutoresearchOptimizerRun,
): string {
  const lines: string[] = [
    "# Autoresearch Optimizer Run",
    "",
    `Generated: ${run.generatedAt}`,
    `Provider: ${run.provider}`,
    `Status: ${run.status}`,
    `Optimizer command: ${run.optimizerCommand}`,
    "",
    "## Summary",
    "",
    `- before mismatches: ${run.summary.beforeMismatchCount}`,
    `- after mismatches: ${run.summary.afterMismatchCount}`,
    `- before invariant mismatches: ${run.summary.beforeInvariantMismatchCount}`,
    `- after invariant mismatches: ${run.summary.afterInvariantMismatchCount}`,
    `- improved: ${run.summary.improved ? "yes" : "no"}`,
    "",
    "## Gates",
    "",
    `- autoresearch evaluate: ${formatOptionalBoolean(run.gates.autoresearchEvaluate)}`,
    `- judgment battle: ${formatOptionalBoolean(run.gates.judgmentBattle)}`,
    `- release check: ${formatOptionalBoolean(run.gates.releaseCheck)}`,
    "",
    "## Changes",
    "",
  ];

  if (run.changes.changedFiles.length === 0) {
    lines.push("- changed files: (none)");
  } else {
    lines.push(...run.changes.changedFiles.map((entry) => `- ${entry}`));
  }

  lines.push("", "## Disallowed Files", "");
  if (run.changes.disallowedFiles.length === 0) {
    lines.push("- (none)");
  } else {
    lines.push(...run.changes.disallowedFiles.map((entry) => `- ${entry}`));
  }

  lines.push("", "## Artifacts", "");
  lines.push(`- brief: ${run.artifacts.briefPath}`);
  if (run.artifacts.briefMarkdownPath) {
    lines.push(`- brief summary: ${run.artifacts.briefMarkdownPath}`);
  }
  lines.push(`- before report: ${run.artifacts.beforeReportPath}`);
  if (run.artifacts.beforeMarkdownPath) {
    lines.push(`- before summary: ${run.artifacts.beforeMarkdownPath}`);
  }
  lines.push(`- after report: ${run.artifacts.afterReportPath}`);
  if (run.artifacts.afterMarkdownPath) {
    lines.push(`- after summary: ${run.artifacts.afterMarkdownPath}`);
  }
  if (run.artifacts.promptPath) {
    lines.push(`- prompt: ${run.artifacts.promptPath}`);
  }
  if (run.artifacts.rawOutputPath) {
    lines.push(`- raw output: ${run.artifacts.rawOutputPath}`);
  }
  if (run.artifacts.patchPath) {
    lines.push(`- patch: ${run.artifacts.patchPath}`);
  }

  if (run.notes.length > 0) {
    lines.push("", "## Notes", "");
    lines.push(...run.notes.map((entry) => `- ${entry}`));
  }

  return `${lines.join("\n")}\n`;
}

export function assessAutoresearchEditSurface(
  changedFiles: readonly string[],
  allowedEditPaths: readonly string[],
): {
  changedFiles: string[];
  disallowedFiles: string[];
} {
  const normalizedAllowed = allowedEditPaths.map((entry) => normalizePath(entry));
  const normalizedChanged = [...new Set(changedFiles.map((entry) => normalizePath(entry)).filter(Boolean))];
  const disallowedFiles = normalizedChanged.filter((entry) => !normalizedAllowed.includes(entry));

  return {
    changedFiles: normalizedChanged,
    disallowedFiles,
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function renderValue(value: string | string[] | boolean | null): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : value.join(", ");
  }
  if (value === null) {
    return "null";
  }
  return String(value);
}

function formatOptionalBoolean(value: boolean | undefined): string {
  if (value === undefined) {
    return "skipped";
  }

  return value ? "pass" : "fail";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
