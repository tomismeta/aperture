import { join } from "node:path";

import {
  formatBullet,
  parseBullet,
  parseHeading,
  parseScalar,
  readMarkdownFile,
} from "./markdown-state.js";
import { readAttentionLane } from "./attention-lane.js";
import type { ContinuityRuleName } from "./continuity/continuity-rule.js";
import { APERTURE_STATE_SCHEMA_VERSION } from "./judgment-defaults.js";

export type PolicyConfig = {
  version: number;
  updatedAt: string;
  policy?: Record<string, PolicyRule>;
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

export type PolicyRule = {
  autoApprove?: boolean;
  mayInterrupt?: boolean;
  minimumLane?: "ambient" | "next" | "now";
  requireContextExpansion?: boolean;
};

export async function loadPolicyConfig(
  rootDir: string,
  fallback: PolicyConfig,
): Promise<PolicyConfig> {
  return readMarkdownFile(join(rootDir, "APERTURE.md"), fallback, parsePolicyConfig);
}

function parsePolicyConfig(content: string): PolicyConfig | null {
  const meta = new Map<string, string>();
  const policy = new Map<string, PolicyRule>();
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
      const scalar = parseScalar(bullet.value);
      const key = normalizePolicyRuleKey(camelKey(bullet.key));
      policy.set(ruleName, {
        ...(policy.get(ruleName) ?? {}),
        ...(key === "minimumLane"
          ? (() => {
              const lane = readAttentionLane(scalar);
              return lane === undefined ? {} : { minimumLane: lane };
            })()
          : { [key]: scalar as never }),
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

  const version = readCurrentMarkdownSchemaVersion(meta.get("version"));
  const updatedAt = meta.get("updated at");
  if (version === null || !updatedAt) {
    return null;
  }

  return {
    version,
    updatedAt,
    ...(policy.size > 0 ? { policy: Object.fromEntries(policy.entries()) } : {}),
    ...(ambiguityDefaults.size > 0
      ? { ambiguityDefaults: Object.fromEntries(ambiguityDefaults.entries()) }
      : {}),
    ...(plannerDefaults.size > 0
      ? { plannerDefaults: Object.fromEntries(plannerDefaults.entries()) }
      : {}),
  };
}

function normalizePolicyRuleKey(key: string): string {
  switch (key) {
    case "minimumPresentation":
      return "minimumLane";
    default:
      return key;
  }
}

export function serializePolicyConfig(config: PolicyConfig): string {
  const lines: string[] = [
    "# Policy",
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
      if (rule.minimumLane !== undefined) {
        lines.push(formatBullet("minimum lane", rule.minimumLane));
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
      lines.push(
        formatBullet(
          "defer low value during pressure",
          config.plannerDefaults.deferLowValueDuringPressure,
        ),
      );
    }
    if (config.plannerDefaults.minimumDwellMs !== undefined) {
      lines.push(formatBullet("minimum dwell ms", config.plannerDefaults.minimumDwellMs));
    }
    if (config.plannerDefaults.streamContinuityMargin !== undefined) {
      lines.push(
        formatBullet("stream continuity margin", config.plannerDefaults.streamContinuityMargin),
      );
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
      config.plannerDefaults.disabledContinuityRules !== undefined &&
      config.plannerDefaults.disabledContinuityRules.length > 0
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

function readCurrentMarkdownSchemaVersion(value: string | undefined): number | null {
  const version = readNumber(value);
  return version === APERTURE_STATE_SCHEMA_VERSION ? version : null;
}

function camelKey(value: string): string {
  return value.replace(/\s+([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

const CONTINUITY_RULE_NAME_FLAGS = {
  same_interaction: true,
  visible_episode: true,
  same_episode: true,
  minimum_dwell: true,
  burst_dampening: true,
  deferral_escalation: true,
  conflicting_interrupt: true,
  decision_stream_continuity: true,
  context_patience: true,
} satisfies Record<ContinuityRuleName, true>;

const CONTINUITY_RULE_NAMES = Object.keys(CONTINUITY_RULE_NAME_FLAGS) as ContinuityRuleName[];

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
