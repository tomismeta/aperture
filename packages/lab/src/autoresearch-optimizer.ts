import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { AUTORESEARCH_OPTIMIZER_RUN_SCHEMA_VERSION } from "./artifact-versions.js";
import type { AutoresearchOptimizationBrief } from "./autoresearch-calibration.js";
import { extractJsonCandidate } from "./json-utils.js";
import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";
import { isRecord } from "./shape.js";
export { AUTORESEARCH_OPTIMIZER_RUN_SCHEMA_VERSION } from "./artifact-versions.js";

export const DEFAULT_AUTORESEARCH_OPTIMIZER_RESULTS_DIR = path.join(
  DEFAULT_LAB_RUNTIME_ROOT,
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
export type AutoresearchOptimizerRunStatus =
  | "clean"
  | "improved"
  | "gate_blocked"
  | "no_change"
  | "regressed"
  | "invalid";

export type AutoresearchOptimizerGateStatus = "pass" | "fail" | "not_run";

export type AutoresearchOptimizerFeedback = {
  action: "patched" | "no_patch";
  summary: string;
  reasons: string[];
  recommendedFiles: string[];
  changedFiles: string[];
  commandsRun: string[];
  beforeMismatchCount?: number;
  afterMismatchCount?: number;
  judgmentBattle?: AutoresearchOptimizerGateStatus;
  releaseCheck?: AutoresearchOptimizerGateStatus;
};

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
  feedback?: AutoresearchOptimizerFeedback;
  notes: string[];
};

export function buildAutoresearchEvaluationCommands(
  extraCalibrationDirs: readonly string[] = [],
): string[] {
  const evaluateCommand = [
    "pnpm",
    "lab:fstop:evaluate",
    ...extraCalibrationDirs.flatMap((directory) => [
      "--extra-calibration-dir",
      shellQuote(directory),
    ]),
  ].join(" ");

  return [evaluateCommand, "pnpm judgment:battle", "pnpm release:check"];
}

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
    "# Aperture Lab F-Stop Optimization Task",
    "",
    "You are the optimizer for Aperture Lab F-Stop's offline semantic calibration loop.",
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
    "2. Prefer structural fixes over single-title or exact-phrase special cases; only add literal phrases when multiple promoted examples clearly share the same stable pattern.",
    "3. Treat the harness evaluation commands as the source of truth. Report only the mismatch counts you actually observed from those commands.",
    "4. If a non-semantic gate fails after a locally improved patch, say that explicitly in your reasons instead of describing the patch itself as a regression.",
    "5. Keep importer fixes separate from semantic fixes unless the promoted examples prove both layers are required.",
    "6. After editing, run these commands yourself:",
    ...brief.evaluationCommands.map((command) => `   - ${command}`),
    "7. Do not create commits or switch branches; leave any surviving changes in the worktree for the harness to capture.",
    "8. If the frozen calibration mismatch count does not improve, stop and explain why.",
    "9. If invariant mismatches appear, treat that as a regression and do not widen the patch.",
    "",
    "Final response:",
    "Return only one JSON object. Do not wrap it in prose.",
    "Use this schema:",
    "```json",
    "{",
    '  "action": "patched" | "no_patch",',
    '  "summary": "short summary of what you changed or why you did not patch",',
    '  "reasons": ["short concrete reason"],',
    '  "recommendedFiles": ["packages/core/src/semantic-interpreter.ts"],',
    '  "changedFiles": ["packages/core/src/semantic-interpreter.ts"],',
    '  "commandsRun": ["pnpm lab:fstop:evaluate ..."],',
    '  "beforeMismatchCount": 5,',
    '  "afterMismatchCount": 4,',
    '  "judgmentBattle": "pass" | "fail" | "not_run",',
    '  "releaseCheck": "pass" | "fail" | "not_run"',
    "}",
    "```",
    'If no patch survives, set "action" to "no_patch", leave "changedFiles" empty, and explain the blocker in "reasons".',
  );

  return `${lines.join("\n")}\n`;
}

export function parseAutoresearchOptimizerFeedback(
  text: string,
): AutoresearchOptimizerFeedback | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const action = parsed.action;
  const summary = parsed.summary;
  if (
    (action !== "patched" && action !== "no_patch") ||
    typeof summary !== "string" ||
    !summary.trim()
  ) {
    return null;
  }

  const beforeMismatchCount = readNumber(parsed.beforeMismatchCount);
  const afterMismatchCount = readNumber(parsed.afterMismatchCount);
  const judgmentBattle = readGateStatus(parsed.judgmentBattle);
  const releaseCheck = readGateStatus(parsed.releaseCheck);

  return {
    action,
    summary: summary.trim(),
    reasons: readStringArray(parsed.reasons),
    recommendedFiles: readStringArray(parsed.recommendedFiles),
    changedFiles: readStringArray(parsed.changedFiles),
    commandsRun: readStringArray(parsed.commandsRun),
    ...(beforeMismatchCount !== undefined ? { beforeMismatchCount } : {}),
    ...(afterMismatchCount !== undefined ? { afterMismatchCount } : {}),
    ...(judgmentBattle !== undefined ? { judgmentBattle } : {}),
    ...(releaseCheck !== undefined ? { releaseCheck } : {}),
  };
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

export function renderAutoresearchOptimizerRunMarkdown(run: AutoresearchOptimizerRun): string {
  const lines: string[] = [
    "# Aperture Lab F-Stop Optimizer Run",
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

  if (run.feedback) {
    lines.push("", "## Optimizer Feedback", "");
    lines.push(`- action: ${run.feedback.action}`);
    lines.push(`- summary: ${run.feedback.summary}`);
    if (run.feedback.reasons.length > 0) {
      lines.push(...run.feedback.reasons.map((entry) => `- reason: ${entry}`));
    }
    if (run.feedback.recommendedFiles.length > 0) {
      lines.push(`- recommended files: ${run.feedback.recommendedFiles.join(", ")}`);
    }
    if (run.feedback.changedFiles.length > 0) {
      lines.push(`- reported changed files: ${run.feedback.changedFiles.join(", ")}`);
    }
    if (run.feedback.commandsRun.length > 0) {
      lines.push(`- commands run: ${run.feedback.commandsRun.join(" | ")}`);
    }
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
  const normalizedChanged = [
    ...new Set(changedFiles.map((entry) => normalizePath(entry)).filter(Boolean)),
  ];
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

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readGateStatus(value: unknown): AutoresearchOptimizerGateStatus | undefined {
  return value === "pass" || value === "fail" || value === "not_run" ? value : undefined;
}

function formatOptionalBoolean(value: boolean | undefined): string {
  if (value === undefined) {
    return "skipped";
  }

  return value ? "pass" : "fail";
}
