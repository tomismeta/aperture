import { join } from "node:path";

import { readFrontmatterFile } from "./markdown-frontmatter.js";

export type JudgmentConfig = {
  version: number;
  updatedAt: string;
  policy?: Record<string, JudgmentRule>;
  plannerDefaults?: {
    batchStatusBursts?: boolean;
    deferLowValueDuringPressure?: boolean;
  };
};

export type JudgmentRule = {
  mayInterrupt?: boolean;
  minimumPresentation?: "ambient" | "queue" | "active";
  requireContextExpansion?: boolean;
  requireReasonOnReject?: boolean;
};

export async function loadJudgmentConfig(
  rootDir: string,
  fallback: JudgmentConfig,
): Promise<JudgmentConfig> {
  return readFrontmatterFile(join(rootDir, "JUDGMENT.md"), fallback);
}
