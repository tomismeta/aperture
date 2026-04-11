import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";
import type { AutoresearchFinalReport } from "./autoresearch-report.js";

export const DEFAULT_AUTORESEARCH_REPORTS_DIR = path.join(
  DEFAULT_LAB_RUNTIME_ROOT,
  "results",
  "autoresearch",
  "reports",
);

export function defaultAutoresearchFinalReportPath(
  generatedAt: string,
  directory = DEFAULT_AUTORESEARCH_REPORTS_DIR,
): string {
  return path.join(directory, `autoresearch-report-${safeTimestamp(generatedAt)}.json`);
}

export function defaultAutoresearchFinalReportMarkdownPath(reportPath: string): string {
  return reportPath.replace(/\.json$/i, ".md");
}

export async function writeAutoresearchFinalReport(
  filePath: string,
  report: AutoresearchFinalReport,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function loadJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function tryLoadJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return await loadJsonFile<T>(filePath);
  } catch {
    return undefined;
  }
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
