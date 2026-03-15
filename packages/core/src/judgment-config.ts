import { join } from "node:path";

import {
  formatBullet,
  parseBullet,
  parseHeading,
  parseScalar,
  readMarkdownFile,
} from "./markdown-state.js";
import type { ContinuityRuleName } from "./continuity/continuity-rule.js";
import { MARKDOWN_SCHEMA_VERSION } from "./judgment-defaults.js";

export type JudgmentConfig = {
  version: number;
  updatedAt: string;
  policy?: Record<string, JudgmentRule>;
  ambiguityDefaults?: AmbiguityDefaults;
  plannerDefaults?: PlannerDefaults;
};

export type AmbiguityDefaults = {
  nonBlockingActivationThreshold?: number;
  promotionMargin?: number;
};

export type PlannerDefaults = {
  batchStatusBursts?: boolean;
  deferLowValueDuringPressure?: boolean;
  minimumDwellMs?: number;
  streamContinuityMargin?: number;
  conflictingInterruptMargin?: number;
  disabledContinuityRules?: ContinuityRuleName[];
};

export type JudgmentRule = {
  autoApprove?: boolean;
  mayInterrupt?: boolean;
  minimumPresentation?: "ambient" | "queue" | "active";
  requireContextExpansion?: boolean;
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
  const ambiguityDefaults = new Map<string, number>();
  const plannerDefaults = new Map<string, boolean | number | ContinuityRuleName[]>();
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
      const key = camelKey(bullet.key);
      if (key === "disabledContinuityRules") {
        const rules = parseContinuityRuleList(bullet.value);
        if (rules.length > 0) {
          plannerDefaults.set(key, rules);
        }
        continue;
      }

      const value = parseScalar(bullet.value);
      if (typeof value === "boolean" || typeof value === "number") {
        plannerDefaults.set(key, value);
      }
      continue;
    }

    if (section === "Ambiguity Defaults") {
      const value = parseScalar(bullet.value);
      if (typeof value === "number") {
        ambiguityDefaults.set(camelKey(bullet.key), value);
      }
    }
  }

  const version = readNumber(meta.get("version"));
  const updatedAt = meta.get("updated at");
  if (version === null || version !== MARKDOWN_SCHEMA_VERSION || !updatedAt) {
    return null;
  }

  return {
    version,
    updatedAt,
    ...(policy.size > 0 ? { policy: Object.fromEntries(policy.entries()) } : {}),
    ...(ambiguityDefaults.size > 0
      ? { ambiguityDefaults: Object.fromEntries(ambiguityDefaults.entries()) }
      : {}),
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
      if (rule.autoApprove !== undefined) {
        lines.push(formatBullet("auto approve", rule.autoApprove));
      }
      if (rule.mayInterrupt !== undefined) {
        lines.push(formatBullet("may interrupt", rule.mayInterrupt));
      }
      if (rule.minimumPresentation !== undefined) {
        lines.push(formatBullet("minimum presentation", rule.minimumPresentation));
      }
      if (rule.requireContextExpansion !== undefined) {
        lines.push(formatBullet("require context expansion", rule.requireContextExpansion));
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
    if (config.plannerDefaults.minimumDwellMs !== undefined) {
      lines.push(formatBullet("minimum dwell ms", config.plannerDefaults.minimumDwellMs));
    }
    if (config.plannerDefaults.streamContinuityMargin !== undefined) {
      lines.push(formatBullet("stream continuity margin", config.plannerDefaults.streamContinuityMargin));
    }
    if (config.plannerDefaults.conflictingInterruptMargin !== undefined) {
      lines.push(
        formatBullet(
          "conflicting interrupt margin",
          config.plannerDefaults.conflictingInterruptMargin,
        ),
      );
    }
    if (
      config.plannerDefaults.disabledContinuityRules !== undefined
      && config.plannerDefaults.disabledContinuityRules.length > 0
    ) {
      lines.push(
        formatBullet(
          "disabled continuity rules",
          config.plannerDefaults.disabledContinuityRules.join(", "),
        ),
      );
    }
  }

  if (config.ambiguityDefaults && Object.keys(config.ambiguityDefaults).length > 0) {
    lines.push("", "## Ambiguity Defaults");
    if (config.ambiguityDefaults.nonBlockingActivationThreshold !== undefined) {
      lines.push(
        formatBullet(
          "non blocking activation threshold",
          config.ambiguityDefaults.nonBlockingActivationThreshold,
        ),
      );
    }
    if (config.ambiguityDefaults.promotionMargin !== undefined) {
      lines.push(formatBullet("promotion margin", config.ambiguityDefaults.promotionMargin));
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

const CONTINUITY_RULE_NAMES: readonly ContinuityRuleName[] = [
  "same_interaction",
  "visible_episode",
  "same_episode",
  "minimum_dwell",
  "burst_dampening",
  "deferral_escalation",
  "conflicting_interrupt",
  "decision_stream_continuity",
  "context_patience",
];

function parseContinuityRuleList(value: string): ContinuityRuleName[] {
  const recognized = new Set<ContinuityRuleName>();
  for (const part of value.split(",")) {
    const normalized = part.trim();
    if (isContinuityRuleName(normalized)) {
      recognized.add(normalized);
    }
  }
  return [...recognized];
}

function isContinuityRuleName(value: string): value is ContinuityRuleName {
  return CONTINUITY_RULE_NAMES.includes(value as ContinuityRuleName);
}
