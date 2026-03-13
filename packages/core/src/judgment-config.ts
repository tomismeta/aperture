import { join } from "node:path";

import {
  formatBullet,
  parseBullet,
  parseHeading,
  parseScalar,
  readMarkdownFile,
} from "./markdown-state.js";

export type JudgmentConfig = {
  version: number;
  updatedAt: string;
  policy?: Record<string, JudgmentRule>;
  plannerDefaults?: PlannerDefaults;
};

export type PlannerDefaults = {
  batchStatusBursts?: boolean;
  deferLowValueDuringPressure?: boolean;
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
  return readMarkdownFile(join(rootDir, "JUDGMENT.md"), fallback, parseJudgmentConfig);
}

function parseJudgmentConfig(content: string): JudgmentConfig | null {
  // TODO: Add explicit migrations if the markdown schema needs a breaking
  // change. For now we keep the format additive and fall back to defaults when
  // required metadata is missing.
  const meta = new Map<string, string>();
  const policy = new Map<string, JudgmentRule>();
  const plannerDefaults = new Map<string, boolean>();
  let section: string | null = null;
  let ruleName: string | null = null;

  for (const line of content.split("\n")) {
    const heading = parseHeading(line);
    if (heading) {
      if (heading.level === 2) {
        section = heading.text;
        ruleName = null;
      } else if (heading.level === 3 && section === "Policy") {
        ruleName = heading.text;
        if (!policy.has(ruleName)) {
          policy.set(ruleName, {});
        }
      }
      continue;
    }

    const bullet = parseBullet(line);
    if (!bullet || !("key" in bullet)) {
      continue;
    }

    if (section === "Meta") {
      meta.set(bullet.key, bullet.value);
      continue;
    }

    if (section === "Policy" && ruleName) {
      policy.set(ruleName, {
        ...(policy.get(ruleName) ?? {}),
        [camelKey(bullet.key)]: parseScalar(bullet.value) as never,
      });
      continue;
    }

    if (section === "Planner Defaults") {
      const value = parseScalar(bullet.value);
      if (typeof value === "boolean") {
        plannerDefaults.set(camelKey(bullet.key), value);
      }
    }
  }

  const version = readNumber(meta.get("version"));
  const updatedAt = meta.get("updated at");
  if (version === null || !updatedAt) {
    return null;
  }

  return {
    version,
    updatedAt,
    ...(policy.size > 0 ? { policy: Object.fromEntries(policy.entries()) } : {}),
    ...(plannerDefaults.size > 0 ? { plannerDefaults: Object.fromEntries(plannerDefaults.entries()) } : {}),
  };
}

export function serializeJudgmentConfig(config: JudgmentConfig): string {
  const lines: string[] = [
    "# Judgment",
    "",
    "## Meta",
    formatBullet("version", config.version),
    formatBullet("updated at", config.updatedAt),
  ];

  if (config.policy && Object.keys(config.policy).length > 0) {
    lines.push("", "## Policy");
    for (const [name, rule] of Object.entries(config.policy)) {
      lines.push("", `### ${name}`);
      if (rule.mayInterrupt !== undefined) {
        lines.push(formatBullet("may interrupt", rule.mayInterrupt));
      }
      if (rule.minimumPresentation !== undefined) {
        lines.push(formatBullet("minimum presentation", rule.minimumPresentation));
      }
      if (rule.requireContextExpansion !== undefined) {
        lines.push(formatBullet("require context expansion", rule.requireContextExpansion));
      }
      if (rule.requireReasonOnReject !== undefined) {
        lines.push(formatBullet("require reason on reject", rule.requireReasonOnReject));
      }
    }
  }

  if (config.plannerDefaults && Object.keys(config.plannerDefaults).length > 0) {
    lines.push("", "## Planner Defaults");
    if (config.plannerDefaults.batchStatusBursts !== undefined) {
      lines.push(formatBullet("batch status bursts", config.plannerDefaults.batchStatusBursts));
    }
    if (config.plannerDefaults.deferLowValueDuringPressure !== undefined) {
      lines.push(formatBullet("defer low value during pressure", config.plannerDefaults.deferLowValueDuringPressure));
    }
  }

  lines.push("");
  return lines.join("\n");
}

function readNumber(value: string | undefined): number | null {
  return value !== undefined && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
}

function camelKey(value: string): string {
  return value.replace(/\s+([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}
